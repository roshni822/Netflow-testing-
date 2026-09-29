-- Narrow platform mutation capability; runtime still cannot create/drop schemas
-- or directly update organization licensing/placement columns.
CREATE FUNCTION system.manage_organization(actor text, organization_id text, expected_version bigint,
  root_patch jsonb, child_patch jsonb, audit_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE org platform.organizations; assignments text; item record; permitted text[]; changed text[]; touched bigint;
  field_paths jsonb:='{"name":"name","subdomain":"subdomain","allowed_domains":"allowedDomains","features":"features","pdf_auto_fill":"pdfAutoFill","plan":"plan","licence_valid_from":"licence.validFrom","licence_valid_until":"licence.validUntil","licence_trial_ends_at":"licence.trialEndsAt","licence_status":"licence.status","licence_notified":"licence.notified","billing_email":"billingEmail","billing_anchor_day":"billingAnchorDay","limits":"limits","storage_extension_extra_mb":"storageExtension.extraMb","storage_extension_expires_at":"storageExtension.expiresAt","storage_extension_granted_by":"storageExtension.grantedBy","storage_extension_reason":"storageExtension.reason","status":"status","is_default":"isDefault","admin_user_id":"adminUserId","id":"_id","created_at":"createdAt","updated_at":"updatedAt","storage_bytes":"usage.storageBytes","file_count":"usage.fileCount","buffer_bytes_used":"usage.bufferBytesUsed","submissions_period_start":"usage.submissions.periodStart","submissions_period_end":"usage.submissions.periodEnd","submissions_count":"usage.submissions.count","notified":"usage.notified","s3_enabled":"integrations.s3.enabled","s3_bucket":"integrations.s3.bucket","s3_endpoint":"integrations.s3.endpoint","s3_region":"integrations.s3.region","s3_access_key_id":"integrations.s3.accessKeyId","s3_secret_access_key":"integrations.s3.secretAccessKey","dms_api_key":"integrations.dmsApiKey","dms_name":"integrations.dmsName","dms_base_url":"integrations.dmsBaseUrl","dms_jwt":"integrations.dmsJwt","dms_enabled":"integrations.dmsEnabled","dms_org_slug":"integrations.dmsOrgSlug"}';
  root_allowed text[]:=ARRAY['name','allowed_domains','features','pdf_auto_fill','plan','licence_valid_from',
    'licence_valid_until','licence_trial_ends_at','licence_status','licence_notified','billing_email','billing_anchor_day',
    'limits','storage_extension_extra_mb','storage_extension_expires_at','storage_extension_granted_by',
    'storage_extension_reason','status'];
BEGIN
  IF current_setting('netflow.system',true) IS DISTINCT FROM 'platform'
    OR nullif(current_setting('netflow.org_id',true),'') IS NOT NULL THEN
    RAISE EXCEPTION 'PLATFORM_ACCESS_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM system.require_platform_admin(actor);
  IF audit_action NOT IN ('org_updated','org_suspended','org_activated','org_storage_extended','org_storage_extension_revoked')
    OR jsonb_typeof(root_patch) IS DISTINCT FROM 'object' OR jsonb_typeof(child_patch) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_MANAGEMENT_PATCH';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('tenant-operation:'||organization_id,0));
  SELECT * INTO org FROM platform.organizations WHERE id=organization_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR org.provisioning_status<>'ready' THEN RAISE EXCEPTION 'ORG_NOT_READY'; END IF;
  IF org.row_version<>expected_version THEN RAISE EXCEPTION 'ORG_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(root_patch) k WHERE NOT k=ANY(root_allowed)) THEN RAISE EXCEPTION 'INVALID_MANAGEMENT_PATCH'; END IF;
  IF root_patch ? 'status' AND ((audit_action='org_suspended' AND root_patch->>'status'<>'suspended')
    OR (audit_action='org_activated' AND root_patch->>'status'<>'active')
    OR audit_action NOT IN ('org_suspended','org_activated')) THEN RAISE EXCEPTION 'INVALID_MANAGEMENT_PATCH'; END IF;
  SELECT string_agg(format('%I=p.%I',k,k),',') INTO assignments FROM jsonb_object_keys(root_patch) k;
  IF assignments IS NOT NULL THEN
    EXECUTE 'UPDATE platform.organizations o SET '||assignments||' FROM jsonb_populate_record(NULL::platform.organizations,$1) p WHERE o.id=$2'
      USING root_patch,organization_id;
    UPDATE platform.organizations SET source_missing=ARRAY(SELECT v FROM unnest(source_missing) v
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_object_keys(root_patch) k WHERE v=field_paths->>k))
      WHERE id=organization_id;
  END IF;
  PERFORM set_config('netflow.org_id',organization_id,true);
  FOR item IN SELECT key,value FROM jsonb_each(child_patch) LOOP
    IF item.key='organization_department_integrations' THEN
      IF jsonb_typeof(item.value)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(item.value) r
        WHERE r->>'owner_id' IS DISTINCT FROM organization_id OR r->>'tenant_id' IS DISTINCT FROM organization_id) THEN
        RAISE EXCEPTION 'INVALID_MANAGEMENT_PATCH';
      END IF;
      EXECUTE format('DELETE FROM %I.organization_department_integrations WHERE owner_id=$1',org.schema_name) USING organization_id;
      EXECUTE format('INSERT INTO %I.organization_department_integrations(owner_id,tenant_id,position,department,api_key,base_url,folder,enabled,department_id)
        SELECT r.owner_id,r.tenant_id,r.position,r.department,r.api_key,r.base_url,r.folder,r.enabled,d.department_id
        FROM jsonb_populate_recordset(NULL::%I.organization_department_integrations,$1) r
        LEFT JOIN %I.organization_departments d ON d.owner_id=r.owner_id AND d.name_key=lower(btrim(r.department))',org.schema_name,org.schema_name,org.schema_name) USING item.value;
    ELSE
      permitted:=CASE item.key WHEN 'organization_usage' THEN ARRAY['submissions_period_start','submissions_period_end','notified']
        WHEN 'organization_integrations' THEN ARRAY['s3_enabled','s3_bucket','s3_endpoint','s3_region','s3_access_key_id','s3_secret_access_key',
          'dms_api_key','dms_name','dms_base_url','dms_jwt','dms_enabled','dms_org_slug'] END;
      IF permitted IS NULL OR jsonb_typeof(item.value)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(item.value) k WHERE NOT k=ANY(permitted)) THEN
        RAISE EXCEPTION 'INVALID_MANAGEMENT_PATCH';
      END IF;
      SELECT string_agg(format('%I=p.%I',k,k),','),array_agg(k) INTO assignments,changed FROM jsonb_object_keys(item.value) k;
      IF assignments IS NOT NULL THEN
        EXECUTE format('UPDATE %I.%I t SET %s,row_version=t.row_version+1,source_missing=ARRAY(SELECT v FROM unnest(t.source_missing) v WHERE NOT v=ANY($3::text[])) FROM jsonb_populate_record(NULL::%I.%I,$1) p WHERE t.owner_id=$2',
          org.schema_name,item.key,assignments,org.schema_name,item.key) USING item.value,organization_id,ARRAY(SELECT field_paths->>k FROM jsonb_object_keys(item.value) k);
        GET DIAGNOSTICS touched=ROW_COUNT;
        IF touched<>1 THEN RAISE EXCEPTION 'ORG_NOT_READY'; END IF;
      END IF;
    END IF;
  END LOOP;
  UPDATE platform.organizations SET updated_at=now(),row_version=row_version+1 WHERE id=organization_id;
  INSERT INTO platform.audit_logs(id,target_org_id,performed_by,action,target_entity,detail,metadata)
    VALUES(replace(gen_random_uuid()::text,'-','')::varchar(24),organization_id,actor,audit_action,org.name,
      'Platform organization management',jsonb_build_object('targetOrgId',organization_id,
        'changedFields',ARRAY(SELECT k FROM jsonb_object_keys(root_patch) k),'changedGroups',ARRAY(SELECT k FROM jsonb_object_keys(child_patch) k)));
  PERFORM set_config('netflow.org_id','',true);
END; $body$;
ALTER FUNCTION system.manage_organization(text,text,bigint,jsonb,jsonb,text) OWNER TO netflow_provisioner;
REVOKE ALL ON FUNCTION system.manage_organization(text,text,bigint,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION system.manage_organization(text,text,bigint,jsonb,jsonb,text) TO netflow_app;

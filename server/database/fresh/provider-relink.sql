-- Temporary restore-session function. JSON numbers stay PostgreSQL numeric;
-- untouched business values never pass through JavaScript floating point.
CREATE OR REPLACE FUNCTION pg_temp.relink_document(value jsonb,mapping jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $body$
DECLARE result jsonb; item record; old_key text; replacement jsonb;
BEGIN
 IF value IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(value)='array' THEN
  SELECT COALESCE(jsonb_agg(pg_temp.relink_document(v,mapping) ORDER BY ord),'[]'::jsonb)
   INTO result FROM jsonb_array_elements(value) WITH ORDINALITY a(v,ord); RETURN result;
 ELSIF jsonb_typeof(value)<>'object' THEN RETURN value; END IF;
 result:='{}'::jsonb;
 FOR item IN SELECT key,v FROM jsonb_each(value) a(key,v) LOOP
  result:=result||jsonb_build_object(item.key,pg_temp.relink_document(item.v,mapping));
 END LOOP;
 FOREACH old_key IN ARRAY ARRAY['dmsDocId','dms_doc_id','s3Key','s3_key'] LOOP
  replacement:=mapping->((CASE WHEN old_key IN ('s3Key','s3_key') THEN 's3:' ELSE 'dms:' END)||(value->>old_key));
  IF replacement IS NOT NULL THEN
   result:=jsonb_set(result,ARRAY[old_key],to_jsonb(substr(replacement->>'key',CASE WHEN old_key IN ('s3Key','s3_key') THEN 4 ELSE 5 END)));
   IF result ? 'url' THEN result:=jsonb_set(result,'{url}','null'); END IF;
   IF result ? 'path' THEN result:=jsonb_set(result,'{path}','null'); END IF;
   IF old_key IN ('dmsDocId','dms_doc_id') THEN result:=result||jsonb_build_object('dmsDepartment',COALESCE(replacement->>'department','')); END IF;
  END IF;
 END LOOP;
 RETURN result;
END; $body$;

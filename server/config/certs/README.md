# Supabase certificate authority

`supabase-root-2021.crt` is a public CA certificate, not a private key or credential.
It was retrieved over verified HTTPS from the production download URL used by
[Supabase's dashboard configuration](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json):

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Set `PGSSL_CA_FILE=config/certs/supabase-root-2021.crt` in `server/.env` when
needed. This trusts the provider's CA for the PostgreSQL client while keeping
certificate and hostname verification enabled. Refer to
[Supabase's SSL documentation](https://supabase.com/docs/guides/platform/ssl-enforcement)
when replacing the certificate or configuring a different database provider.

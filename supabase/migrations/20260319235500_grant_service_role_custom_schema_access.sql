grant usage on schema ingestion to service_role;
grant usage on schema normalization to service_role;
grant usage on schema admin to service_role;
grant usage on schema quality to service_role;

grant select, insert, update, delete on all tables in schema ingestion to service_role;
grant select, insert, update, delete on all tables in schema normalization to service_role;
grant select, insert, update, delete on all tables in schema admin to service_role;
grant select, insert, update, delete on all tables in schema quality to service_role;

alter default privileges in schema ingestion
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema normalization
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema admin
grant select, insert, update, delete on tables to service_role;

alter default privileges in schema quality
grant select, insert, update, delete on tables to service_role;

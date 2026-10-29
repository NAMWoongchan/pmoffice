begin;
alter table pmoffice_private.member_mail_nonces enable row level security;
alter table pmoffice_private.member_access_migration_backup enable row level security;
alter table pmoffice_private.member_registration_attempts enable row level security;
commit;

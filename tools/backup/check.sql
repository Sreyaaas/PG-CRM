-- Restore drill check (BE-53): run against the source and the restored database and compare the output.
SELECT 'migrations' AS what, count(*) AS n FROM schema_migrations
UNION ALL SELECT 'organizations', count(*) FROM organizations
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'properties', count(*) FROM properties
UNION ALL SELECT 'beds', count(*) FROM beds
UNION ALL SELECT 'residents', count(*) FROM residents
UNION ALL SELECT 'stays', count(*) FROM stays
UNION ALL SELECT 'invoices', count(*) FROM invoices
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'expenses', count(*) FROM expenses
UNION ALL SELECT 'complaints', count(*) FROM complaints
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
UNION ALL SELECT 'rls_tables', count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'guard_triggers', count(*) FROM pg_trigger WHERE NOT tgisinternal
ORDER BY 1;

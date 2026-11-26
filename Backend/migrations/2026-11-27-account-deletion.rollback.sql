-- Rollback for account deletion requests: drops the request table. Accounts already completed stay switched off and
-- without contact details (that is the point of a deletion and is not undone). Roll the code back first.
DROP TABLE IF EXISTS account_deletion_requests;

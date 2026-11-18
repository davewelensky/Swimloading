\set ON_ERROR_STOP 1
\set dave   '''df137255-3add-4153-b368-32e06e2be188'''
\set carina '''cff2fc33-4a55-451b-8c7f-20f12c1898ce'''
\set other  '''11111111-1111-1111-1111-111111111111'''
\echo '--- VERIFY 1: roles'
select role, scope, resource_id is not null as scoped, revoked_at is null as active from user_roles order by granted_at;
\echo '--- VERIFY 2: log after migration'
select entity, action, summary, actor_id = :dave as by_dave from jaked_activity_log;

\echo '--- T1 Carina (authenticated) creates + completes a task'
set role authenticated; select set_config('request.jwt.claim.sub', :carina, false);
select can_manage_partner(jaked_partner_id()) as carina_can;
insert into jaked_tasks (title, area, owner_id, due_date) values ('Get JAKED commercial price list in writing','supplier', :carina, '2026-11-25');
update jaked_tasks set status='done';
select title, status, completed_at is not null as completed, updated_by = :carina as upd_by_carina from jaked_tasks;
select entity, action, summary, actor_id = :carina as by_carina from jaked_activity_log where entity='task' order by id;

\echo '--- T2 Carina cannot delete a task, cannot write the log, cannot see enquiries table directly'
do $$ begin begin delete from jaked_tasks; raise exception 'FAIL delete allowed'; exception when insufficient_privilege then raise notice 'OK delete blocked'; end; end $$;
do $$ begin begin insert into jaked_activity_log(entity,entity_id,action) values ('task',gen_random_uuid(),'created'); raise exception 'FAIL log insert allowed'; exception when insufficient_privilege then raise notice 'OK log insert blocked'; end; end $$;
do $$ begin begin perform * from partner_enquiries; raise exception 'FAIL enquiries readable'; exception when insufficient_privilege then raise notice 'OK enquiries server-only'; end; end $$;
do $$ begin begin insert into jaked_tasks (title, created_by) values ('spoof', 'df137255-3add-4153-b368-32e06e2be188'); raise exception 'FAIL spoofed created_by'; exception when insufficient_privilege then raise notice 'OK cannot spoof created_by'; end; end $$;
select count(*) as carina_sees_log_rows from jaked_activity_log;
do $$ begin begin perform grant_role('11111111-1111-1111-1111-111111111111','partner_manager','partner','eb8644d9-28d2-4d08-87f1-4230da07e1c5'); raise exception 'FAIL carina granted'; exception when raise_exception then raise notice 'OK Carina cannot grant roles: %', sqlerrm; end; end $$;

\echo '--- T3 random signed-in user sees nothing, cannot insert'
select set_config('request.jwt.claim.sub', :other, false);
select can_manage_partner(jaked_partner_id()) as other_can, (select count(*) from jaked_tasks) as tasks_visible, (select count(*) from jaked_activity_log) as log_visible;
do $$ begin begin insert into jaked_tasks (title) values ('x'); raise exception 'FAIL other inserted'; exception when insufficient_privilege then raise notice 'OK other blocked'; end; end $$;

\echo '--- T4 anon sees nothing'
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
do $$ begin begin perform * from jaked_tasks; raise exception 'FAIL anon read tasks'; exception when insufficient_privilege then raise notice 'OK anon blocked from tasks'; end; end $$;
do $$ begin begin perform * from jaked_activity_log; raise exception 'FAIL anon read log'; exception when insufficient_privilege then raise notice 'OK anon blocked from log'; end; end $$;
do $$ begin begin perform * from user_roles; raise exception 'FAIL anon read roles'; exception when insufficient_privilege then raise notice 'OK anon blocked from user_roles'; end; end $$;
do $$ begin begin perform has_role('platform_admin'); raise exception 'FAIL anon ran has_role'; exception when insufficient_privilege then raise notice 'OK anon cannot run has_role'; end; end $$;
do $$ begin begin perform grant_role('11111111-1111-1111-1111-111111111111','partner_manager','partner','eb8644d9-28d2-4d08-87f1-4230da07e1c5'); raise exception 'FAIL anon ran grant_role'; exception when insufficient_privilege then raise notice 'OK anon cannot run grant_role'; end; end $$;

\echo '--- T5 service role (API): web form, manual WhatsApp lead with phone only, status change by Carina'
reset role; set role service_role;
insert into partner_enquiries (partner, reference, customer_name, email, product_category, consent_contact, consent_text)
 values ('jaked','JKD-WEB001','Web Person','w@example.com','racing_swimsuit',true,'I agree');
insert into partner_enquiries (partner, reference, customer_name, phone, product_category, consent_contact, consent_text, entry_method, channel, created_by)
 values ('jaked','JKD-WAP001','WhatsApp Person','+27 82 000 0000','open_water_wetsuit',true,'Asked on WhatsApp to be contacted','manual','whatsapp', :carina);
do $$ begin begin insert into partner_enquiries (partner, reference, customer_name, product_category, consent_contact, consent_text) values ('jaked','JKD-BAD001','No Contact','racing_swimsuit',true,'x'); raise exception 'FAIL web form w/o email'; exception when check_violation then raise notice 'OK web form needs email: %', sqlerrm; end; end $$;
do $$ begin begin insert into partner_enquiries (partner, reference, customer_name, phone, product_category, consent_contact, consent_text, entry_method, channel) values ('jaked','JKD-BAD002','No author','+27','racing_swimsuit',true,'x','manual','whatsapp'); raise exception 'FAIL manual w/o author'; exception when check_violation then raise notice 'OK manual needs author: %', sqlerrm; end; end $$;
update partner_enquiries set status='contacted', assigned_to=:carina, updated_by=:carina where reference='JKD-WAP001';
update partner_enquiries set updated_at=now() where reference='JKD-WAP001';  -- no meaningful change: must NOT log
select entity, action, summary, actor_id = :carina as by_carina, actor_id is null as no_actor, changes from jaked_activity_log where entity='enquiry' order by id;

\echo '--- T6 log is immutable even for service role / owner'
do $$ begin begin update jaked_activity_log set summary='tampered'; raise exception 'FAIL updated'; exception when raise_exception then raise notice 'OK %', sqlerrm; end; end $$;
do $$ begin begin delete from jaked_activity_log; raise exception 'FAIL deleted'; exception when raise_exception then raise notice 'OK %', sqlerrm; end; end $$;
reset role;
do $$ begin begin truncate jaked_activity_log; raise exception 'FAIL truncated'; exception when raise_exception then raise notice 'OK %', sqlerrm; end; end $$;

\echo '--- T7 Dave revokes Carina via revoke_role(); she loses access; revoke is logged'
set role authenticated; select set_config('request.jwt.claim.sub', :dave, false);
select revoke_role((select id from user_roles where user_id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce')) as revoked;
select set_config('request.jwt.claim.sub', :carina, false);
select can_manage_partner(jaked_partner_id()) as carina_can_after_revoke, (select count(*) from jaked_tasks) as tasks_visible;
reset role;
select entity, action, summary, actor_id = :dave as by_dave from jaked_activity_log where entity='role' order by id;
\echo '--- VERIFY 6/7: RLS + grants'
select relname, relrowsecurity from pg_class where relname in ('jaked_tasks','jaked_activity_log','_bak_20261118_partner_enquiries','user_roles') order by 1;
select count(*) as bad_log_grants from information_schema.role_table_grants where table_name='jaked_activity_log' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
select count(*) as backup_rows from _bak_20261118_partner_enquiries;
\echo '--- T8 deletes are logged (service role deletes an enquiry)'
reset role; set role service_role; select set_config('request.jwt.claim.sub', '', false);
delete from partner_enquiries where reference='JKD-WEB001';
reset role;
select entity, action, summary, changes from jaked_activity_log where action='deleted';

\echo '--- T9 hardening: trigger functions not callable directly, triggers still fire for every role'
set role authenticated; select set_config('request.jwt.claim.sub', 'cff2fc33-4a55-451b-8c7f-20f12c1898ce', false);
do $$ begin begin perform jaked_log_change(); raise exception 'FAIL called trigger fn'; exception when insufficient_privilege then raise notice 'OK authenticated cannot call jaked_log_change'; end; end $$;
reset role; select set_config('request.jwt.claim.sub', 'df137255-3add-4153-b368-32e06e2be188', false); set role authenticated;
select grant_role('cff2fc33-4a55-451b-8c7f-20f12c1898ce','partner_manager','partner','eb8644d9-28d2-4d08-87f1-4230da07e1c5') is not null as dave_regranted_carina;
select set_config('request.jwt.claim.sub', 'cff2fc33-4a55-451b-8c7f-20f12c1898ce', false);
insert into jaked_tasks (title, area) values ('Hardening check task','operations');
reset role; set role service_role; select set_config('request.jwt.claim.sub', '', false);
insert into partner_enquiries (partner, reference, customer_name, email, product_category, consent_contact, consent_text) values ('jaked','JKD-WEB002','Web Two','w2@example.com','racing_swimsuit',true,'I agree');
reset role;
select summary from jaked_activity_log where summary in ('Task created: Hardening check task','Enquiry JKD-WEB002 received via the web form','JAKED access granted (partner_manager)') order by id;
do $$ begin if (select count(*) from jaked_activity_log where summary in ('Task created: Hardening check task','Enquiry JKD-WEB002 received via the web form')) = 2 then raise notice 'OK triggers fire after hardening (authenticated + service_role)'; else raise exception 'FAIL triggers did not log'; end if; end $$;

\set ON_ERROR_STOP 1
-- Behaviour tests for sql/2026-11-18_jaked-business-store.sql (run after 00_stub + the 3 applied migrations + this migration).
reset role;
insert into jaked_business_catalogue (snapshot_date, payload) values ('2026-11-16', '{"products":[{"sku":"BLADE","wholesale":300}],"variants":[{"sku":"BLADE_L","parent":"BLADE","ws":3}]}');
\echo '--- S1 Carina reads catalogue + workspace, saves v0 -> v1'
set role authenticated; select set_config('request.jwt.claim.sub','cff2fc33-4a55-451b-8c7f-20f12c1898ce',false);
do $$ begin if (select count(*) from jaked_business_catalogue)=1 and (select version from jaked_business_workspace)=0 then raise notice 'OK Carina reads catalogue + workspace'; else raise exception 'FAIL Carina read'; end if; end $$;
do $$ declare v int; begin select version into v from jaked_business_save(0,'{"orders":[{"id":"o1","name":"First Jaked order","stage":"Enquiry"}],"cases":{},"inventory":[]}','First save'); if v=1 then raise notice 'OK Carina saved v1'; else raise exception 'FAIL save'; end if; end $$;
\echo '--- S2 Dave saves against stale v0 -> conflict, nothing overwritten'
select set_config('request.jwt.claim.sub','df137255-3add-4153-b368-32e06e2be188',false);
do $$ begin begin perform jaked_business_save(0,'{"orders":[],"cases":{},"inventory":[]}','Stale'); raise exception 'FAIL stale save accepted'; exception when serialization_failure then raise notice 'OK stale save refused: %', sqlerrm; end; end $$;
do $$ begin if (select jsonb_array_length(state->'orders') from jaked_business_workspace)=1 then raise notice 'OK partner work not overwritten'; else raise exception 'FAIL overwritten'; end if; end $$;
\echo '--- S3 Dave moves the order stage; log records it'
do $$ begin perform jaked_business_save(1,'{"orders":[{"id":"o1","name":"First Jaked order","stage":"Quoted"}],"cases":{},"inventory":[]}','Quoted first order'); raise notice 'OK Dave saved v2'; end $$;
\echo '--- S4 bad input refused'
do $$ begin begin perform jaked_business_save(2,'{"cases":{},"inventory":[]}','No orders'); raise exception 'FAIL malformed accepted'; exception when invalid_parameter_value then raise notice 'OK malformed state refused'; end; end $$;
do $$ begin begin perform jaked_business_save(2,'{"orders":[],"cases":{},"inventory":[]}',''); raise exception 'FAIL empty summary accepted'; exception when invalid_parameter_value then raise notice 'OK empty summary refused'; end; end $$;
\echo '--- S5 no direct writes for the team'
do $$ begin begin update jaked_business_workspace set version=99; raise exception 'FAIL direct update'; exception when insufficient_privilege then raise notice 'OK direct workspace update blocked'; end; end $$;
do $$ begin begin insert into jaked_business_catalogue(snapshot_date,payload) values ('2026-11-17','{"products":[],"variants":[]}'); raise exception 'FAIL catalogue insert'; exception when insufficient_privilege then raise notice 'OK catalogue insert blocked'; end; end $$;
\echo '--- S6 unrelated signed-in user: sees nothing, cannot save'
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$ begin if (select count(*) from jaked_business_catalogue)=0 and (select count(*) from jaked_business_workspace)=0 then raise notice 'OK other user sees no catalogue/workspace'; else raise exception 'FAIL other user read'; end if; end $$;
do $$ begin begin perform jaked_business_save(2,'{"orders":[],"cases":{},"inventory":[]}','Intruder'); raise exception 'FAIL other user saved'; exception when insufficient_privilege then raise notice 'OK other user save refused'; end; end $$;
\echo '--- S7 anon: no table access, no function'
reset role; set role anon; select set_config('request.jwt.claim.sub','',false);
do $$ begin begin perform * from jaked_business_catalogue; raise exception 'FAIL anon read catalogue'; exception when insufficient_privilege then raise notice 'OK anon blocked from catalogue'; end; end $$;
do $$ begin begin perform jaked_business_save(2,'{"orders":[],"cases":{},"inventory":[]}','anon'); raise exception 'FAIL anon saved'; exception when insufficient_privilege then raise notice 'OK anon cannot call save'; end; end $$;
reset role;
\echo '--- S8 audit trail content'
select summary, actor_id = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce' as by_carina, actor_id = 'df137255-3add-4153-b368-32e06e2be188' as by_dave, changes->'version' as version, changes->'stage_changes' as stages, changes->'sections' as sections, changes ? 'state_md5' as has_md5 from jaked_activity_log where entity='workspace' order by id;
do $$ begin if (select count(*) from jaked_activity_log where entity='workspace')=2
  and (select changes->'stage_changes'->0->>'to' from jaked_activity_log where entity='workspace' order by id desc limit 1)='Quoted'
  and (select changes->>'state_md5' from jaked_activity_log where entity='workspace' order by id desc limit 1)=(select md5(state::text) from jaked_business_workspace)
  then raise notice 'OK 2 saves logged, stage change Enquiry->Quoted recorded, md5 matches saved state'; else raise exception 'FAIL audit content'; end if; end $$;

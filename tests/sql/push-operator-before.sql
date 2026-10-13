-- Existing Production-shaped registered device fixture, before proposed migration. No HTTP.
insert into auth.users(id,email) values
 ('b0000000-0000-0000-0000-000000000001','operator-owner@example.invalid'),
 ('b0000000-0000-0000-0000-000000000002','operator-other@example.invalid'),
 ('b0000000-0000-0000-0000-000000000003','operator-approver@example.invalid');
insert into public.admin_memberships(user_id) values('b0000000-0000-0000-0000-000000000003');
insert into public.push_preferences(user_id,enabled,cities,categories) values
 ('b0000000-0000-0000-0000-000000000001',true,'[{"name":"Isolated","latitude":42,"longitude":23,"zone":"UTC"}]','{wind}');
update public.push_controls set registration_test_user_id=null,test_delivery_enabled=true,vapid_public_key='B'||repeat('A',86);
insert into public.push_devices(id,user_id,endpoint,fingerprint,p256dh,auth_key,label,vapid_public_key) values
 ('b1000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001',
 'https://fcm.googleapis.com/wp/operator-fixture',encode(sha256(convert_to('https://fcm.googleapis.com/wp/operator-fixture','UTF8')),'hex'),
 'B'||repeat('A',86),repeat('A',22),'Note 13 Pro','B'||repeat('A',86));
create temporary table operator_existing_device as select to_jsonb(d) as snapshot from public.push_devices d where id='b1000000-0000-0000-0000-000000000001';
create temporary table operator_existing_preferences as select to_jsonb(p) as snapshot from public.push_preferences p where user_id='b0000000-0000-0000-0000-000000000001';

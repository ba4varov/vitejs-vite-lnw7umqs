-- Synthetic extension of the existing B1/B2a CI fixture only.
-- The live push_devices table already has these columns.
alter table public.push_devices
  add column endpoint text,
  add column p256dh text,
  add column auth_key text;
update public.push_devices set
  endpoint='https://fcm.googleapis.com/wp/synthetic-fixture',
  p256dh=repeat('A',87),
  auth_key=repeat('B',22);

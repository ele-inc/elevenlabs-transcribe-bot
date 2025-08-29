#!make

deploy:
	supabase functions deploy --no-verify-jwt scribe-bot

install:
	cd supabase/functions/scribe-bot && deno cache index.ts

reload-cache:
	deno cache --reload ./supabase/functions/scribe-bot/index.ts

set-secret:
	supabase secrets set --env-file supabase/functions/.env

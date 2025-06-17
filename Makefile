#!make

deploy:
	supabase functions deploy --no-verify-jwt scribe-bot

reload-cache:
	deno cache --reload ./supabase/functions/scribe-bot/index.ts

set-secret:
	supabase secrets set --env-file supabase/functions/.env

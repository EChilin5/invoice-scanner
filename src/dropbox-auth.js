import 'dotenv/config';

const code = process.argv[2];
const res = await fetch('https://api.dropbox.com/oauth2/token', {
  method: 'POST',
  body: new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: process.env.DROPBOX_APP_KEY,
    client_secret: process.env.DROPBOX_APP_SECRET,
  }),
});
const json = await res.json();
console.log(json.refresh_token ?? json);
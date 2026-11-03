import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticate } from '@google-cloud/local-auth';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');


async function loadSavedClient() {
  try {
    const saved = JSON.parse(await fs.readFile(TOKEN_PATH, 'utf8'));
    return google.auth.fromJSON(saved);
  } catch {
    return null;
  }
}

async function saveClient(client) {
  const keys = JSON.parse(await fs.readFile(CREDENTIALS_PATH, 'utf8'));
  const key = keys.installed || keys.web;
  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    })
  );
}

export async function authorize() {
  const saved = await loadSavedClient();
  if (saved) return saved;

  const client = await authenticate({ scopes: SCOPES, keyfilePath: CREDENTIALS_PATH });
  if (client.credentials?.refresh_token) await saveClient(client);
  return client;
}
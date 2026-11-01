import { google } from 'googleapis';
import { authorize } from './auth.js';

const auth = await authorize();
const gmail = google.gmail({ version: 'v1', auth });
const { data } = await gmail.users.getProfile({ userId: 'me' });
console.log('Connected as:', data.emailAddress, '| historyId:', data.historyId);
import { google } from 'googleapis';
import * as store from './store.js';          // NEW

export async function startPolling(auth, onNewMessage, intervalMs = 30000) {
  // creates a gmail client using the user's credentials
  const gmail = google.gmail({ version: 'v1', auth });

  // NEW: sets the bookmark to "right now" using the profile's latest history id
  async function resetCheckpoint() {
    const { data } = await gmail.users.getProfile({ userId: 'me' });
    store.setState('lastHistoryId', data.historyId);
    return data.historyId;
  }

  // NEW: load the saved bookmark, or create one on the very first run
  let historyId = store.getState('lastHistoryId') ?? (await resetCheckpoint());
  let running = false;                         // NEW: overlap guard

  async function poll() {
    if (running) return;                       // skip if the last poll is still going
    running = true;
    try {
      let pageToken;
      let newest = historyId;

      do {                                     // NEW: loop through all pages
        const { data } = await gmail.users.history.list({
          userId: 'me',
          startHistoryId: historyId,
          historyTypes: ['messageAdded'],      // only new emails, ignore deletions and label changes
          labelId: 'INBOX',                    // only things in the inbox
          pageToken,
        });

        for (const h of data.history ?? []) {
          for (const m of h.messagesAdded ?? []) {
            await onNewMessage(m.message.id);  // hands off the id only
          }
        }
        if (data.historyId) newest = data.historyId;
        pageToken = data.nextPageToken;
      } while (pageToken);

      // NEW: only advance the bookmark after the whole batch succeeded,
      // and save it to the database
      historyId = newest;
      store.setState('lastHistoryId', historyId);
    } catch (err) {
      if (err.code === 404) {
        // Gmail discards old history; our bookmark is too old to use
        console.warn('History ID expired, resetting bookmark (some mail may be missed)');
        historyId = await resetCheckpoint();
      } else {
        console.error('Poll failed:', err.message);
      }
    } finally {
      running = false;
    }
  }

  poll();                                      // run once immediately
  setInterval(poll, intervalMs);
}
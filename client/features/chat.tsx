import { useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Banner, EmptyState, Note, SectionCard, SkeletonRows } from '../components/ui';
import { useResource } from '../hooks/useResource';
import type { AccountContext } from '../lib/account';
import {
  createConversation,
  loadConversation,
  loadFamilyMembers,
  loadMessages,
  markConversationRead,
  sendMessage,
} from '../lib/data';
import { formatRelative, initials } from '../lib/format';
import type { ConversationRow } from '../lib/schema';

export function ChatPanel({
  client,
  familyId,
  account,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
}) {
  const conversation = useResource(
    `conversation:${familyId}`,
    () => loadConversation(client, familyId),
    15000,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setPending(true);
    setError(null);
    try {
      await createConversation(client, familyId);
      conversation.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the family chat.');
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard title="Family chat" aside="conversations · messages">
      {error ? (
        <Banner tone="error" title="Chat unavailable">
          {error}
        </Banner>
      ) : null}

      {conversation.error ? (
        <Banner tone="error" title="Chat could not be loaded">
          {conversation.error}
        </Banner>
      ) : null}

      {conversation.loading && !conversation.data ? <SkeletonRows count={3} /> : null}

      {!conversation.loading && !conversation.error && !conversation.data ? (
        <EmptyState title="No family conversation yet">
          <span>
            Your schema allows one conversation per family. FamGuard does not create one
            automatically; the first parent or child in the family can start it here.
          </span>
          <span className="empty-action">
            <button type="button" className="primary" onClick={onCreate} disabled={pending}>
              {pending ? 'Starting…' : 'Start family chat'}
            </button>
          </span>
        </EmptyState>
      ) : null}

      {conversation.data ? (
        <MessageList client={client} conversation={conversation.data} account={account} />
      ) : null}
    </SectionCard>
  );
}

function MessageList({
  client,
  conversation,
  account,
}: {
  client: SupabaseClient;
  conversation: ConversationRow;
  account: AccountContext;
}) {
  const messages = useResource(
    `messages:${conversation.id}`,
    () => loadMessages(client, conversation.id),
    8000,
  );
  const members = useResource(
    `chat-members:${conversation.family_id}`,
    () => loadFamilyMembers(client, conversation.family_id),
    120000,
  );

  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readPending, setReadPending] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    map.set(account.userId, account.displayName);
    for (const entry of members.data?.members ?? []) {
      map.set(
        entry.member.user_id,
        entry.profile?.display_name?.trim() || `Member ${entry.member.user_id.slice(0, 8)}`,
      );
    }
    return map;
  }, [members.data, account]);

  const rows = messages.data ?? [];
  const unreadFromOthers = rows.filter(
    (row) => row.sender_user_id !== account.userId && row.read_at === null,
  ).length;

  const onSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    setPending(true);
    setError(null);
    try {
      await sendMessage(client, {
        conversationId: conversation.id,
        senderUserId: account.userId,
        body: trimmed,
      });
      setBody('');
      messages.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message could not be sent.');
    } finally {
      setPending(false);
    }
  };

  const onMarkRead = async () => {
    setReadPending(true);
    setReadError(null);
    try {
      await markConversationRead(client, conversation.id, account.userId);
      messages.refresh();
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : 'Could not mark messages as read.');
    } finally {
      setReadPending(false);
    }
  };

  return (
    <>
      {error ? (
        <Banner tone="error" title="Message not sent">
          {error}
        </Banner>
      ) : null}
      {messages.error ? (
        <Banner tone="error" title="Messages unavailable">
          {messages.error}
        </Banner>
      ) : null}

      {messages.loading && !messages.data ? <SkeletonRows count={4} /> : null}

      {messages.data && rows.length === 0 ? (
        <EmptyState title="No messages yet">Send the first message to your family.</EmptyState>
      ) : null}

      {rows.length > 0 ? (
        <ul className="msg-list">
          {rows.map((row) => {
            const own = row.sender_user_id === account.userId;
            const sender = names.get(row.sender_user_id) ?? `Member ${row.sender_user_id.slice(0, 8)}`;
            return (
              <li key={row.id} className={own ? 'msg msg-own' : 'msg'}>
                <div className="msg-head">
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {initials(sender)}
                  </span>
                  <span className="msg-sender">{own ? 'You' : sender}</span>
                  <span className="muted small">{formatRelative(row.created_at)}</span>
                </div>
                <div className="msg-body">
                  {row.kind === 'text' ? (
                    row.body
                  ) : (
                    <span className="muted">
                      [{row.kind} message — this build only renders text messages]
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <form className="composer" onSubmit={onSend}>
        <label className="field grow">
          <span className="sr-only">Message</span>
          <input
            type="text"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a message…"
            maxLength={2000}
          />
        </label>
        <button type="submit" className="primary" disabled={pending || body.trim().length === 0}>
          {pending ? 'Sending…' : 'Send'}
        </button>
        {unreadFromOthers > 0 ? (
          <button type="button" className="secondary" onClick={onMarkRead} disabled={readPending}>
            {readPending ? 'Marking…' : `Mark ${unreadFromOthers} read`}
          </button>
        ) : null}
      </form>

      {readError ? <Banner tone="warn">{readError}</Banner> : null}

      <Note>
        Messages poll every 8 seconds because Supabase Realtime is not enabled for this project, and
        “mark read” updates <code>read_at</code> on messages from other members.
      </Note>
    </>
  );
}

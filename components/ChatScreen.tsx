import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QUICK_REPLIES, type ChatRole } from '../lib/chatReplies';
import { colors, radii, spacing, typography } from '../lib/theme';
import supabase from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  order_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type Props = {
  orderId: string;
  currentUserId: string;
  otherUserName: string;
  // Drives which set of pre-defined quick replies appears above the input.
  role: ChatRole;
  // Header close control. The sheet (<ChatModal>) closes the sheet; the
  // full-screen route passes router.back(). The header ALWAYS calls this prop —
  // never a hardcoded router.back() — so both presentations behave correctly.
  onClose?: () => void;
  // Optional contact details for the header. Rendered only when provided, so
  // existing hosts don't need to pass them yet.
  otherAvatarUrl?: string | null;
  otherPhone?: string | null;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatScreen({
  orderId,
  currentUserId,
  otherUserName,
  role,
  onClose,
  otherAvatarUrl,
  otherPhone,
}: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!orderId) return;
    fetchMessages();

    const channel = supabase
      .channel(`chat-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          console.log('[ChatScreen] new message:', payload.new);
          setMessages((prev) => [...prev, payload.new as Message]);
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }
      )
      .subscribe((status) => {
        console.log('[ChatScreen] channel status:', status);
      });

    return () => { supabase.removeChannel(channel); };
  }, [orderId]);

  // ── Data ──────────────────────────────────────────────────────────────────

  async function fetchMessages() {
    const { data } = await supabase
      .from('messages')
      .select('id, order_id, sender_id, content, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data as Message[]);
    setLoading(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setText('');

    const { error } = await supabase
      .from('messages')
      .insert({ order_id: orderId, sender_id: currentUserId, content: trimmed });

    setSending(false);
    if (error) setText(trimmed); // restore on failure
  }

  // Pre-fill the input with a quick reply (overwrites any draft) and focus so
  // the user can edit/extend or hit send immediately.
  function handleQuickReply(reply: string) {
    setText(reply);
    inputRef.current?.focus();
  }

  // ── Render item ───────────────────────────────────────────────────────────

  function renderItem({ item, index }: { item: Message; index: number }) {
    const isMine = item.sender_id === currentUserId;
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const isFirstInGroup = !prevMsg || prevMsg.sender_id !== item.sender_id;

    const time = new Date(item.created_at).toLocaleTimeString('en-PH', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={[styles.bubbleWrapper, isMine ? styles.bubbleWrapperMine : styles.bubbleWrapperOther]}>
        {!isMine && isFirstInGroup && (
          <Text style={styles.senderName}>{otherUserName}</Text>
        )}
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextOther]}>
            {item.content}
          </Text>
        </View>
        <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampOther]}>
          {time}
        </Text>
      </View>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header — dark green. Close ALWAYS calls the injected onClose prop
          (sheet-close for <ChatModal>, router.back() for the full-screen route). */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => onClose?.()}
          hitSlop={8}
          activeOpacity={0.7}
        >
          <Feather name="chevron-down" size={22} color={colors.headerText} />
        </TouchableOpacity>

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerName} numberOfLines={1}>{otherUserName}</Text>
          <View style={styles.headerSubRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.headerSub} numberOfLines={1}>
              Order #{orderId.slice(-8).toUpperCase()}
            </Text>
          </View>
        </View>

        {otherPhone ? (
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => Linking.openURL(`tel:${otherPhone}`)}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Feather name="phone" size={18} color={colors.headerText} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="message-circle" size={40} color={colors.textFaint} />
              <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
            </View>
          }
        />
      )}

      {/* Quick replies — horizontal pills above the input. Sits inside the
          KeyboardAvoidingView so it rides up with the keyboard. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickRepliesWrap}
        contentContainerStyle={styles.quickReplies}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_REPLIES[role].map((reply) => (
          <TouchableOpacity
            key={reply}
            style={styles.quickReplyPill}
            onPress={() => handleQuickReply(reply)}
          >
            <Text style={styles.quickReplyText}>{reply}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={500}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendButton, (!text.trim() || sending) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // Header — dark green. Fixed top padding (NOT insets.top): the full-screen
  // route already wraps ChatScreen with paddingTop:insets.top, and the sheet
  // host needs no top inset.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.headerBg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.headerSurface,
    borderWidth: 1,
    borderColor: colors.headerSurfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: { width: 38, height: 38, borderRadius: radii.pill },
  headerAvatarInitials: { fontSize: 15, fontWeight: '700', color: colors.headerText },
  headerTextWrap: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '700', color: colors.headerText },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.headerAccent,
  },
  headerSub: { ...typography.caption, color: colors.headerSubtext },

  // Loading
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Message list
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: spacing.md,
  },
  emptyText: { fontSize: 14, color: colors.textMuted },

  // Bubbles
  bubbleWrapper: { marginBottom: 6, maxWidth: '80%' },
  bubbleWrapperMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { fontSize: 11, color: colors.textSecondary, marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: radii.lg, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTextOther: { color: colors.text },
  timestamp: { fontSize: 10, color: colors.textMuted, marginTop: 3 },
  timestampMine: { alignSelf: 'flex-end', marginRight: 2 },
  timestampOther: { alignSelf: 'flex-start', marginLeft: 2 },

  // Quick replies
  quickRepliesWrap: {
    flexGrow: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  quickReplies: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  quickReplyPill: {
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickReplyText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '500',
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    color: colors.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});

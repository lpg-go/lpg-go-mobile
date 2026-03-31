import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatScreen({ orderId, currentUserId, otherUserName }: Props) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
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
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} hitSlop={8}>
          <Feather name="chevron-left" size={26} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{otherUserName}</Text>
          <Text style={styles.headerSubtitle}>Order #{orderId.slice(-8).toUpperCase()}</Text>
        </View>
        <View style={{ width: 34 }} />
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PRIMARY} />
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
              <Feather name="message-circle" size={40} color="#D1D5DB" />
              <Text style={styles.emptyText}>No messages yet. Say hello!</Text>
            </View>
          }
        />
      )}

      {/* Input bar */}
      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          placeholderTextColor="#9CA3AF"
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

const PRIMARY = '#16A34A';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  backButton: { width: 34 },
  headerCenter: { alignItems: 'center', flex: 1 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },

  // Loading
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Message list
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyText: { fontSize: 14, color: '#9CA3AF' },

  // Bubbles
  bubbleWrapper: { marginBottom: 6, maxWidth: '80%' },
  bubbleWrapperMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperOther: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  senderName: { fontSize: 11, color: '#9CA3AF', marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: PRIMARY, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#E5E7EB', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTextOther: { color: '#111827' },
  timestamp: { fontSize: 10, color: '#9CA3AF', marginTop: 3 },
  timestampMine: { alignSelf: 'flex-end', marginRight: 2 },
  timestampOther: { alignSelf: 'flex-start', marginLeft: 2 },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  input: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14,
    color: '#111827',
    maxHeight: 100,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});

import { Modal, StyleSheet, View } from 'react-native';

import ChatScreen from './ChatScreen';

type Props = {
  visible: boolean;
  onClose: () => void;
  orderId: string;
  currentUserId: string;
  otherUserName: string;
};

// Chat as a bottom-sheet popup (like the Choose Payment Method sheet). Mounts the
// chat only while visible so the realtime subscription is set up / torn down with it.
export default function ChatModal({ visible, onClose, orderId, currentUserId, otherUserName }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {visible && currentUserId ? (
            <ChatScreen
              orderId={orderId}
              currentUserId={currentUserId}
              otherUserName={otherUserName}
              onClose={onClose}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '92%',
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
});

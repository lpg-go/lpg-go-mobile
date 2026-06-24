export type ChatRole = 'customer' | 'provider';

export const QUICK_REPLIES: Record<ChatRole, string[]> = {
  customer: [
    'Saan na po kayo?',
    'Pakibilis po',
    'Tagal pa po ba?',
    'Tama yung address?',
    'Pakitawag na lang po pagdating',
    'Salamat po!',
  ],
  provider: [
    'Papunta na po',
    'Andito na po',
    '5 minutes po',
    'Anong landmark po?',
    'Saan po yung gate/door?',
    'Tagal po ng traffic, sorry',
    'Salamat po sa order!',
  ],
};

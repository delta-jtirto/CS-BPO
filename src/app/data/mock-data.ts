import { MessageSquare, Globe, Phone } from 'lucide-react';
import type { Host, Property, Ticket, KBEntry, Task } from './types';

/** Helper: convert HH:MM time string into epoch ms for today (mock backfill) */
function mockTs(time: string): number {
  const [h, m] = time.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export const MOCK_HOSTS: Host[] = [
  { id: 'h1', name: 'Delta Luxe Management', tone: 'Professional & High-End', brandColor: 'bg-purple-600' },
  { id: 'h2', name: 'Urban Stays Co.', tone: 'Casual & Friendly', brandColor: 'bg-emerald-600' },
  { id: 'h3', name: 'M-Connect', tone: 'Professional & Service-Focused', brandColor: 'bg-blue-600' },
];

export const MOCK_PROPERTIES: Property[] = [
  { id: 'p1', hostId: 'h1', name: 'Villa Azure', location: 'Bali, Indonesia', units: 1, status: 'Active', lastSyncedAt: '2025-12-11T10:30:00Z', portalToken: 'va-portal-abc123' },
  { id: 'p2', hostId: 'h2', name: 'Shinjuku Lofts', location: 'Tokyo, Japan', units: 8, roomNames: ['Room 101', 'Room 102', 'Room 201', 'Room 202', 'Room 301', 'Room 302', 'Room 401', 'Room 402'], status: 'Active', lastSyncedAt: '2025-12-25T14:00:00Z', portalToken: 'sl-portal-def456' },
  { id: 'p3', hostId: 'h2', name: 'Tahoe Cabins', location: 'California, USA', units: 4, roomNames: ['Cabin A', 'Cabin B', 'Cabin C', 'Cabin D'], status: 'Onboarding', portalToken: 'tc-portal-ghi789' },
  { id: 'p4', hostId: 'h3', name: 'Hikari to Terrace', location: 'Nagano, Japan', units: 2, roomNames: ['2F: WA (和)', '3F: KOKORO (心)'], status: 'Active', lastSyncedAt: '2026-03-20T10:00:00Z', portalToken: 'ht-portal-jkl012' },
];

export const MOCK_TICKETS: Ticket[] = [
  {
    id: 't-101', guestName: 'Elena Rodriguez', channel: 'Airbnb', channelIcon: MessageSquare,
    host: MOCK_HOSTS[0], property: 'Villa Azure', room: 'Entire Villa',
    status: 'urgent', sla: '03:12', aiHandoverReason: 'Maintenance Request (AC Broken)',
    summary: 'Guest reports the AC in the master bedroom is blowing warm air.',
    tags: ['Maintenance', 'High Priority'], language: 'English',
    messages: [
      { id: 1, sender: 'guest', text: 'Hi, we just got back to the villa and the AC in the main bedroom is broken.', time: '14:05', createdAt: mockTs('14:05') },
      { id: 2, sender: 'bot', text: 'Hi Elena! I\'m sorry to hear about the AC issue. I\'ve noted this down and am passing it to our support team who can arrange a repair. Someone will follow up with you shortly — hang tight!', time: '14:06', createdAt: mockTs('14:06') },
      { id: 3, sender: 'system', text: 'Handed to Agent — Maintenance requires vendor dispatch (outside AI capability). Holding message sent to guest. Please reply manually or dispatch repair vendor.', time: '14:10', createdAt: mockTs('14:10') },
    ],
    booking: { checkIn: 'Oct 12', checkOut: 'Oct 18', guests: 4, status: 'Checked In' }
  },
  {
    id: 't-102', guestName: 'Kenji Sato', channel: 'Booking.com', channelIcon: Globe,
    host: MOCK_HOSTS[1], property: 'Shinjuku Lofts', room: 'Room 402',
    status: 'warning', sla: '11:45', aiHandoverReason: 'Complex Inquiry (Luggage)',
    summary: 'Guest wants to drop bags early at 10 AM, but check-in is 3 PM.',
    tags: ['Logistics', 'Needs Approval'], language: 'Japanese (Auto-translated)',
    messages: [
      { id: 1, sender: 'guest', text: '(Translated) Hello, our flight arrives very early tomorrow. Can we drop our luggage at 10:00 AM?', time: '13:50', createdAt: mockTs('13:50') },
      { id: 2, sender: 'bot', text: '(Translated) Hello Kenji! Thanks for reaching out. I\'m checking on luggage drop-off options for your early arrival. Let me connect you with our team to coordinate.', time: '13:50', createdAt: mockTs('13:50') },
      { id: 3, sender: 'system', text: 'Handed to Agent — Not in knowledge base: Luggage / Storage (wants to drop bags before check-in). Holding message sent to guest. Please reply manually or coordinate with cleaning vendor.', time: '13:51', createdAt: mockTs('13:51') },
    ],
    booking: { checkIn: 'Tomorrow', checkOut: 'Oct 16', guests: 2, status: 'Upcoming' }
  },
  {
    id: 't-103', guestName: 'Sarah Chen', channel: 'Airbnb', channelIcon: MessageSquare,
    host: MOCK_HOSTS[0], property: 'Villa Azure', room: 'Entire Villa',
    status: 'normal', sla: '18:30', aiHandoverReason: 'Wi-Fi Connectivity Issue',
    summary: 'Guest reports intermittent Wi-Fi disconnections affecting remote work.',
    tags: ['Wi-Fi/Tech', 'Maintenance'], language: 'English',
    messages: [
      { id: 1, sender: 'guest', text: 'Hey! The Wi-Fi keeps dropping every 10-15 minutes. I\'m trying to work remotely and it\'s really frustrating. Is there anything I can do?', time: '09:15', createdAt: mockTs('09:15') },
      { id: 2, sender: 'bot', text: 'Hi Sarah! Sorry about the connectivity issues. Here\'s what usually fixes it: Your Wi-Fi network is AzureVilla_5G (password: balibreeze2024). Try restarting the router — it\'s in the TV cabinet. Unplug the power, wait 30 seconds, then plug it back in. This resolves most connection drops.', time: '09:16', createdAt: mockTs('09:16') },
      { id: 3, sender: 'system', text: 'AI Handled — Answered from knowledge base: Wi-Fi / Connectivity. Router restart instructions sent. No agent action needed.', time: '09:20', createdAt: mockTs('09:20') },
      { id: 4, sender: 'guest', text: 'I tried restarting the router like the bot said but it\'s still dropping. Can someone help?', time: '09:32', createdAt: mockTs('09:32') },
    ],
    booking: { checkIn: 'Oct 10', checkOut: 'Oct 17', guests: 2, status: 'Checked In' }
  },
  {
    id: 't-104', guestName: 'Marcus Weber', channel: 'Booking.com', channelIcon: Globe,
    host: MOCK_HOSTS[1], property: 'Shinjuku Lofts', room: 'Room 301',
    status: 'normal', sla: '22:15', aiHandoverReason: 'Schedule Change Request (Late Checkout)',
    summary: 'Guest requesting late checkout until 2 PM due to late evening flight.',
    tags: ['Check-out', 'Policies'], language: 'English',
    messages: [
      { id: 1, sender: 'guest', text: 'Hi there, our flight isn\'t until 11 PM tomorrow. Would it be possible to check out at 2 PM instead of 10 AM? Happy to pay extra if needed.', time: '20:05', createdAt: mockTs('20:05') },
      { id: 2, sender: 'system', text: 'Handed to Agent — Not in knowledge base: Late Checkout Request. Policy decisions require human approval. Please reply manually.', time: '20:06', createdAt: mockTs('20:06') },
    ],
    booking: { checkIn: 'Oct 11', checkOut: 'Tomorrow', guests: 1, status: 'Checked In' }
  },
  {
    id: 't-105', guestName: 'Yuki Tanaka', channel: 'Airbnb', channelIcon: Phone,
    host: MOCK_HOSTS[1], property: 'Shinjuku Lofts', room: 'Room 202',
    status: 'warning', sla: '06:40', aiHandoverReason: 'Noise Complaint (Neighboring Unit)',
    summary: 'Guest reports loud music from upstairs unit past midnight, unable to sleep.',
    tags: ['Noise', 'House Rules'], language: 'Japanese (Auto-translated)',
    messages: [
      { id: 1, sender: 'guest', text: '(Translated) There is very loud music coming from the room above us. It is past midnight and we cannot sleep. Please help.', time: '00:15', createdAt: mockTs('00:15') },
      { id: 2, sender: 'bot', text: '(Translated) I\'m very sorry about the disturbance, Yuki. Quiet hours are 10 PM to 8 AM and this is unacceptable. I\'m flagging this immediately for our team to handle.', time: '00:16', createdAt: mockTs('00:16') },
      { id: 3, sender: 'system', text: 'Handed to Agent — Noise complaint during quiet hours requires immediate action. Contacting neighboring unit needed. Please respond urgently.', time: '00:16', createdAt: mockTs('00:16') },
      { id: 4, sender: 'guest', text: '(Translated) It has been 30 minutes and the noise is still going. My children are awake now.', time: '00:45', createdAt: mockTs('00:45') },
    ],
    booking: { checkIn: 'Oct 10', checkOut: 'Oct 14', guests: 4, status: 'Checked In' }
  },
  {
    id: 't-106', guestName: 'James Park', channel: 'Airbnb', channelIcon: MessageSquare,
    host: MOCK_HOSTS[0], property: 'Villa Azure', room: 'Entire Villa',
    status: 'normal', sla: '23:50', aiHandoverReason: 'Multi-topic: Directions + Wi-Fi',
    summary: 'Pre-arrival guest asking about airport transfer and Wi-Fi details for remote work.',
    tags: ['Transportation', 'Wi-Fi/Tech', 'Check-in'], language: 'English',
    messages: [
      { id: 1, sender: 'guest', text: 'Hi! We arrive at Ngurah Rai airport tomorrow at 2 PM. What\'s the best way to get to the villa? Also, I work remotely — is the Wi-Fi reliable for video calls?', time: '16:30', createdAt: mockTs('16:30') },
      { id: 2, sender: 'bot', text: 'Hi James! Great questions. For Wi-Fi — the villa has a dedicated 5G network that works well for video calls. Regarding airport transfer, let me connect you with our team who can recommend the best transport option from Ngurah Rai.', time: '16:31', createdAt: mockTs('16:31') },
      { id: 3, sender: 'system', text: 'Partially Answered — AI covered Wi-Fi / Connectivity from KB. Agent needed for: Directions / Transport (airport transfer inquiry). Please follow up on the remaining topics.', time: '16:31', createdAt: mockTs('16:31') },
    ],
    booking: { checkIn: 'Tomorrow', checkOut: 'Oct 20', guests: 3, status: 'Upcoming' }
  }
];

// =============================================================================
// KNOWLEDGE BASE — Seed data for Active properties
// New properties get their KB populated via the Onboarding Form Builder
// =============================================================================

export const MOCK_KB: KBEntry[] = [
  // Delta Luxe — Host Global
  { id: 1, hostId: 'h1', propId: null, roomId: null, scope: 'Host Global', title: 'Cancellation Policy', content: 'Airbnb: Strict policy (50% refund up to 7 days before check-in). Booking.com: Non-refundable rate is default. Direct bookings: Full refund 14 days before, 50% up to 7 days, no refund after.', tags: ['Billing', 'Policies'] },
  { id: 2, hostId: 'h1', propId: null, roomId: null, scope: 'Host Global', title: 'Compensation Authority', content: 'CS team may issue refunds/coupons up to $100 USD without owner approval. Amounts above $100 require owner sign-off within 24 hours.', tags: ['Billing', 'Policies'], internal: true },

  // Urban Stays — Host Global
  { id: 100, hostId: 'h2', propId: null, roomId: null, scope: 'Host Global', title: 'Luggage Drop-off Policy', content: 'Early luggage drop-off is not available due to tight turnover schedules. Direct guests to nearby coin lockers (station-specific locations per property). Post-checkout storage: available until 6 PM same day if arranged in advance.', tags: ['Policies', 'Logistics', 'Check-in'] },
  { id: 101, hostId: 'h2', propId: null, roomId: null, scope: 'Host Global', title: 'Cancellation Policy', content: 'Airbnb: Moderate policy (full refund 5+ days before check-in). Booking.com: Free cancellation until 48 hours before for flexible rate.', tags: ['Billing', 'Policies'] },

  // M-Connect — Host Global
  { id: 200, hostId: 'h3', propId: null, roomId: null, scope: 'Host Global', title: 'Guest Communication Policy', content: 'All guest messages should be responded to within 30 minutes during active hours (8 AM – 10 PM JST). After hours, auto-reply should acknowledge receipt and set expectations for morning follow-up.', tags: ['Policies'] },
  { id: 201, hostId: 'h3', propId: null, roomId: null, scope: 'Host Global', title: 'Cancellation Policy', content: 'Standard: Full refund 7+ days before check-in. 50% refund 3–6 days before. No refund within 48 hours. Direct bookings: handled case-by-case by M-Connect team.', tags: ['Billing', 'Policies'] },
];

/** Hospitality KB tag taxonomy — expanded to cover all hearing sheet categories */
export const KB_TAG_TAXONOMY: string[] = [
  'Check-in',
  'Check-out',
  'Maintenance',
  'HVAC',
  'Wi-Fi/Tech',
  'Amenities',
  'Policies',
  'Vendors',
  'Emergency',
  'Cleaning',
  'Parking',
  'Noise',
  'Logistics',
  'Security',
  'Billing',
  'Transportation',
  'Local Info',
  'Utilities',
  'House Rules',
];

export const INITIAL_TASKS: Task[] = [
  { id: 'tsk-1', title: 'Fix AC in Master BR', host: 'Delta Luxe', prop: 'Villa Azure', vendor: 'Bali Breeze HVAC', status: 'dispatched', due: 'Today, 18:00' },
  { id: 'tsk-2', title: 'Mid-stay Cleaning', host: 'Urban Stays', prop: 'Shinjuku Lofts - 402', vendor: 'Tokyo Clean Co', status: 'pending', due: 'Tomorrow, 11:00' },
];
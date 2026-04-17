import { useState, useEffect } from 'react';
import { fetchBookingDetails, fetchPaymentData, type BookingDetails } from '@/lib/pms-api';
import { useAppContext } from '@/app/context/AppContext';

export function useBookingDetails(bookingId: number | undefined, firestoreHostId: string | undefined) {
  const { markFirestoreConnectionExpired } = useAppContext();
  const [bookingDetails, setBookingDetails] = useState<BookingDetails | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);

  useEffect(() => {
    if (!bookingId || !firestoreHostId) {
      setBookingDetails(null);
      return;
    }
    const tokens = JSON.parse(localStorage.getItem('settings_inbox_tokens') || '{}');
    const token = tokens[firestoreHostId];
    if (!token) return;

    setBookingLoading(true);

    // Surface PMS 401/403 as a connection-health change so the Reconnect banner
    // appears automatically (same UX as Firebase custom-token expiry).
    const onAuthError = () => markFirestoreConnectionExpired(firestoreHostId);

    Promise.all([
      fetchBookingDetails(bookingId, token, onAuthError),
      fetchPaymentData(bookingId, token, onAuthError),
    ])
      .then(([details, payment]) => {
        if (details && payment) {
          details.totalDue = payment.totalDue;
          details.amountPaid = payment.paid;
          details.amountDue = payment.amountDue;
        }
        setBookingDetails(details);
      })
      .finally(() => setBookingLoading(false));
  }, [bookingId, firestoreHostId, markFirestoreConnectionExpired]);

  return { bookingDetails, bookingLoading };
}

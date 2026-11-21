import { Platform, Linking, NativeModules, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { normalizePhoneNumber } from '../utils/phone';

export interface EmergencyContact {
  id?: string;
  name: string;
  phone: string;
  relationship?: string;
  memberUserId?: string;
}

export interface SendEmergencySMSParams {
  senderName: string;
  senderPhone?: string;
  senderId?: string;
  lat?: number;
  lng?: number;
  battery?: number | null;
  customRecipients?: string[];
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
}

export interface SendMemberAlertSMSParams {
  senderName: string;
  senderPhone?: string;
  senderId?: string;
  recipientName: string;
  recipientPhone: string;
  lat?: number;
  lng?: number;
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
}

export interface SendEmergencySMSResult {
  success: boolean;
  recipients: string[];
  recipientNames: string[];
  message: string;
  method: 'supabase-api' | 'direct-sms' | 'expo-sms' | 'native-sms' | 'none';
  provider?: string;
  isFallback?: boolean;
  error?: string;
}

interface DispatchMetadata {
  senderName?: string;
  senderPhone?: string;
  senderId?: string;
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
}

/**
 * Checks and requests Android SEND_SMS permission so SMS can be sent
 * directly in the background without opening the external Messages app.
 */
export async function requestSMSPermissionIfNeeded(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
    if (hasPermission) return true;

    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'Emergency SMS Permission',
        message: 'Abucay Guardian needs permission to send direct emergency SMS alerts to your family members if internet is unavailable.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return status === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    console.warn('[EmergencySMSService] SMS permission request error:', e);
    return false;
  }
}

/**
 * Checks whether native direct SMS sending is supported on this device.
 */
export function isDirectSMSAvailable(): boolean {
  return Platform.OS === 'android' && Boolean(NativeModules?.DirectSMS?.sendDirectSMS);
}

/**
 * Retrieves all registered and cached emergency family contacts for a user.
 * Works offline by leveraging AsyncStorage cache, ensuring family numbers
 * are reachable even during severe network/power outages.
 */
export async function getEmergencyFamilyContacts(userId?: string): Promise<EmergencyContact[]> {
  const contactsMap = new Map<string, EmergencyContact>();

  // 1. Read locally cached family members (guaranteed offline access)
  try {
    const cached = await AsyncStorage.getItem('@abucay_cached_family_members');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const rawPhone = item.phone || item.member?.phone;
          if (rawPhone) {
            const normalized = normalizePhoneNumber(rawPhone);
            if (normalized && !contactsMap.has(normalized)) {
              contactsMap.set(normalized, {
                id: item.id,
                name: item.name || item.member?.name || 'Family Member',
                phone: normalized,
                relationship: item.relationship || 'Family',
                memberUserId: item.member_user_id,
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[EmergencySMSService] Error reading cached family contacts:', e);
  }

  // 2. Query Supabase for real-time family members if online and userId is available
  if (userId) {
    try {
      // A. Direct family members added by this user
      const { data: directMembers, error: directErr } = await supabase
        .from('family_members')
        .select('id, name, phone, relationship, member_user_id')
        .eq('user_id', userId);

      if (!directErr && directMembers && Array.isArray(directMembers)) {
        for (const m of directMembers) {
          if (m.phone) {
            const normalized = normalizePhoneNumber(m.phone);
            if (normalized) {
              contactsMap.set(normalized, {
                id: m.id,
                name: m.name,
                phone: normalized,
                relationship: m.relationship || 'Family',
                memberUserId: m.member_user_id,
              });
            }
          }
        }
      }

      // B. Reciprocal family members (where current user was added by someone else)
      const { data: reciprocalMembers, error: recipErr } = await supabase
        .from('family_members')
        .select('id, user_id, relationship')
        .eq('member_user_id', userId);

      if (!recipErr && reciprocalMembers && Array.isArray(reciprocalMembers)) {
        const reciprocalUserIds = reciprocalMembers
          .map((r) => r.user_id)
          .filter(Boolean);

        if (reciprocalUserIds.length > 0) {
          const { data: usersData } = await supabase
            .from('users')
            .select('id, name, phone')
            .in('id', reciprocalUserIds);

          if (usersData && Array.isArray(usersData)) {
            for (const u of usersData) {
              if (u.phone) {
                const normalized = normalizePhoneNumber(u.phone);
                if (normalized) {
                  contactsMap.set(normalized, {
                    name: u.name || 'Family Member',
                    phone: normalized,
                    relationship: 'Family',
                    memberUserId: u.id,
                  });
                }
              }
            }
          }
        }
      }

      // C. Refresh phone numbers from users table for paired family members
      const memberUserIds = Array.from(contactsMap.values())
        .map((c) => c.memberUserId)
        .filter((id): id is string => Boolean(id) && id !== userId);

      if (memberUserIds.length > 0) {
        const { data: latestUsers } = await supabase
          .from('users')
          .select('id, name, phone')
          .in('id', memberUserIds);

        if (latestUsers && Array.isArray(latestUsers)) {
          for (const lu of latestUsers) {
            if (lu.phone) {
              const normalized = normalizePhoneNumber(lu.phone);
              if (normalized) {
                const existing = contactsMap.get(normalized);
                contactsMap.set(normalized, {
                  ...existing,
                  name: lu.name || existing?.name || 'Family Member',
                  phone: normalized,
                  relationship: existing?.relationship || 'Family',
                  memberUserId: lu.id,
                });
              }
            }
          }
        }
      }
    } catch (dbErr) {
      console.warn('[EmergencySMSService] Online family fetch error:', dbErr);
    }
  }

  return Array.from(contactsMap.values());
}

/**
 * Builds the standard emergency SOS SMS body with vital life-saving details.
 */
export function buildEmergencySOSMessage(params: {
  senderName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  battery?: number | null;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  let batteryText = '';
  if (params.battery !== undefined && params.battery !== null && params.battery >= 0) {
    const pct = Math.round(params.battery > 1 ? params.battery : params.battery * 100);
    batteryText = `🔋 Battery: ${pct}%\n`;
  }

  let locationText = '📍 Live GPS: Location Pending (Check Abucay Guardian Live Map)\n';
  if (params.lat !== undefined && params.lng !== undefined) {
    const latFormatted = params.lat.toFixed(5);
    const lngFormatted = params.lng.toFixed(5);
    locationText = `📍 Live GPS: https://maps.google.com/?q=${latFormatted},${lngFormatted}\n(Coordinates: ${latFormatted}, ${lngFormatted})\n`;
  }

  return (
    `🚨 EMERGENCY SOS DISTRESS ALERT!\n` +
    `Your family member "${params.senderName}" is in distress and urgently seeking help!\n\n` +
    locationText +
    batteryText +
    `⏰ Time: ${dateStr} ${timeStr}\n\n` +
    `⚠️ Please call them or contact emergency services (911 / Abucay MDRRMO) immediately!\n` +
    `— Abucay Guardian Emergency System`
  );
}

/**
 * Builds the standard "Are You Okay?" (Check-in) SMS message.
 */
export function buildCheckInSMSMessage(params: {
  senderName: string;
  recipientName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  let locationText = '';
  if (params.lat !== undefined && params.lng !== undefined) {
    const latFormatted = params.lat.toFixed(5);
    const lngFormatted = params.lng.toFixed(5);
    locationText = `📍 Sender GPS: https://maps.google.com/?q=${latFormatted},${lngFormatted}\n`;
  }

  return (
    `⚠️ EMERGENCY SAFETY CHECK: ARE YOU OKAY?\n` +
    `Hi ${params.recipientName}, ${params.senderName} is checking on your safety status via Abucay Guardian.\n\n` +
    `Please reply 'SAFE' or 'NEED HELP' as soon as you see this!\n` +
    locationText +
    `⏰ Time: ${dateStr} ${timeStr}\n\n` +
    `— Sent via Abucay Guardian Emergency System`
  );
}

/**
 * Builds the standard "Loud Ping" (Alarm siren) SMS message.
 */
export function buildLoudPingSMSMessage(params: {
  senderName: string;
  recipientName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  let locationText = '';
  if (params.lat !== undefined && params.lng !== undefined) {
    const latFormatted = params.lat.toFixed(5);
    const lngFormatted = params.lng.toFixed(5);
    locationText = `📍 Sender GPS: https://maps.google.com/?q=${latFormatted},${lngFormatted}\n`;
  }

  return (
    `🚨 URGENT LOUD PING ALARM!\n` +
    `Hi ${params.recipientName}, ${params.senderName} triggered a high-priority emergency alarm on your phone via Abucay Guardian!\n\n` +
    `⚠️ Please open the app or call/text back immediately to confirm your safety!\n` +
    locationText +
    `⏰ Time: ${dateStr} ${timeStr}\n\n` +
    `— Sent via Abucay Guardian Emergency System`
  );
}

/**
 * Smart Dual-Mode SMS Dispatch:
 *
 * 1. PRIMARY: Supabase Cloud SMS API (Edge Function / Webhook).
 *    When the user has internet/WiFi (even with 0 cellular balance/load),
 *    the cloud SMS API sends the SMS directly to family members for free!
 *
 * 2. FALLBACK: Native Device Cellular SMS (SmsManager via DirectSMSModule).
 *    If the user has NO internet connection, or if the Supabase SMS API call fails,
 *    it automatically falls back to sending direct individual SMS from the device SIM.
 */
async function dispatchSMSToRecipients(
  targetPhones: string[],
  recipientNames: string[],
  message: string,
  metadata?: DispatchMetadata
): Promise<SendEmergencySMSResult> {
  const uniquePhones: string[] = [];
  const uniqueNames: string[] = [];
  targetPhones.forEach((phone, idx) => {
    const norm = normalizePhoneNumber(phone);
    if (norm && !uniquePhones.includes(norm)) {
      uniquePhones.push(norm);
      uniqueNames.push(recipientNames[idx] || 'Family Member');
    }
  });

  if (uniquePhones.length === 0) {
    console.warn('[EmergencySMSService] No valid recipient phone numbers provided.');
    return {
      success: false,
      recipients: [],
      recipientNames: [],
      message,
      method: 'none',
      error: 'No valid phone numbers found on record. Please add mobile numbers for family members.',
    };
  }

  // Check network connectivity
  let isOnline = false;
  try {
    const netState = await NetInfo.fetch();
    isOnline = Boolean(netState.isConnected && netState.isInternetReachable !== false);
  } catch (netErr) {
    console.warn('[EmergencySMSService] NetInfo check failed:', netErr);
  }

  // ==============================================================
  // 1. PRIMARY: SUPABASE SMS API / EDGE FUNCTION (Requires Internet, No SIM Load Needed)
  // ==============================================================
  if (isOnline) {
    console.log(`[EmergencySMSService] Online: Attempting PRIMARY Supabase SMS API dispatch for ${uniquePhones.length} recipient(s)...`);
    try {
      const { data, error } = await supabase.functions.invoke('send-emergency-sms', {
        body: {
          recipients: uniquePhones,
          recipientNames: uniqueNames,
          message,
          senderName: metadata?.senderName,
          senderPhone: metadata?.senderPhone,
          senderId: metadata?.senderId,
          alertType: metadata?.alertType || 'sos',
        },
      });

      // Also record the dispatch in Supabase emergency_sms_dispatches for logging / webhooks
      try {
        await supabase.from('emergency_sms_dispatches').insert(
          uniquePhones.map((phone, idx) => ({
            sender_id: metadata?.senderId || null,
            sender_name: metadata?.senderName || 'Family Member',
            sender_phone: metadata?.senderPhone || null,
            recipient_phone: phone,
            recipient_name: uniqueNames[idx] || null,
            message,
            alert_type: metadata?.alertType || 'sos',
            status: !error && data?.success ? 'sent' : 'fallback_device',
            provider: data?.provider || 'supabase_edge_function',
          }))
        );
      } catch (logErr) {
        console.warn('[EmergencySMSService] Dispatch log write error:', logErr);
      }

      if (!error && data && data.success) {
        console.log(`[EmergencySMSService] Successfully dispatched SMS via Supabase Cloud Gateway (${data.provider})`);
        return {
          success: true,
          recipients: uniquePhones,
          recipientNames: uniqueNames,
          message,
          method: 'supabase-api',
          provider: data.provider || 'cloud-sms',
          isFallback: false,
        };
      }

      console.warn(
        '[EmergencySMSService] Supabase SMS API returned error or was unconfigured, seamlessly initiating native cellular fallback:',
        error || data
      );
    } catch (apiErr) {
      console.warn(
        '[EmergencySMSService] Supabase SMS API invocation threw error, initiating native cellular fallback:',
        apiErr
      );
    }
  } else {
    console.log('[EmergencySMSService] Device is OFFLINE. Using direct device cellular SMS fallback.');
  }

  // ==============================================================
  // 2. FALLBACK: NATIVE DEVICE CELLULAR SMS (No Internet Needed, Uses SIM Radio)
  // ==============================================================
  if (Platform.OS === 'android' && NativeModules?.DirectSMS) {
    const hasPermission = await requestSMSPermissionIfNeeded();
    if (hasPermission) {
      try {
        let sentCount = 0;
        // Transmit individual messages (never create a group MMS/SMS thread)
        for (let i = 0; i < uniquePhones.length; i++) {
          const phone = uniquePhones[i];
          try {
            await NativeModules.DirectSMS.sendDirectSMS(phone, message);
            sentCount++;
            console.log(`[EmergencySMSService] Direct cellular SMS delivered to individual recipient ${phone}`);
          } catch (individualErr) {
            console.warn(`[EmergencySMSService] Direct cellular SMS to ${phone} failed:`, individualErr);
          }
        }

        if (sentCount > 0) {
          return {
            success: true,
            recipients: uniquePhones,
            recipientNames: uniqueNames,
            message,
            method: 'direct-sms',
            isFallback: isOnline, // true if it was a fallback after cloud API attempt
          };
        }
      } catch (nativeErr) {
        console.warn('[EmergencySMSService] DirectSMS native module failed, falling back to OS dialer:', nativeErr);
      }
    } else {
      console.warn('[EmergencySMSService] SEND_SMS permission was denied by user.');
    }
  }

  // ==============================================================
  // 3. FINAL RESORT: NATIVE SMS INTENT (iOS / Denied Permission)
  // ==============================================================
  try {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const singleUrl = `sms:${uniquePhones[0]}${separator}body=${encodeURIComponent(message)}`;
    await Linking.openURL(singleUrl);
    return {
      success: true,
      recipients: [uniquePhones[0]],
      recipientNames: [uniqueNames[0]],
      message,
      method: 'native-sms',
      isFallback: true,
    };
  } catch (finalErr: any) {
    console.error('[EmergencySMSService] Failed to send SMS via all methods:', finalErr);
    return {
      success: false,
      recipients: uniquePhones,
      recipientNames: uniqueNames,
      message,
      method: 'none',
      error: finalErr?.message || 'Could not send SMS message.',
    };
  }
}

/**
 * Sends emergency SOS SMS to family members:
 * Primary: Supabase Cloud SMS API (no cellular load required).
 * Fallback: Native Device SMS (works offline during internet/power outages).
 */
export async function sendEmergencySMSToFamily(
  params: SendEmergencySMSParams
): Promise<SendEmergencySMSResult> {
  const contacts = await getEmergencyFamilyContacts(params.senderId);

  let targetPhones: string[] = [];
  let recipientNames: string[] = [];

  if (params.customRecipients && params.customRecipients.length > 0) {
    targetPhones = params.customRecipients;
    recipientNames = params.customRecipients;
  } else {
    for (const c of contacts) {
      if (c.phone) {
        targetPhones.push(c.phone);
        recipientNames.push(c.name);
      }
    }
  }

  const message = buildEmergencySOSMessage({
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
    battery: params.battery,
  });

  return dispatchSMSToRecipients(targetPhones, recipientNames, message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: params.alertType || 'sos',
  });
}

/**
 * Sends a Safety Check-in ("Are You Okay?") SMS to an individual member:
 * Primary: Supabase Cloud SMS API. Fallback: Native Device SMS.
 */
export async function sendCheckInSMSToMember(
  params: SendMemberAlertSMSParams
): Promise<SendEmergencySMSResult> {
  const message = buildCheckInSMSMessage({
    senderName: params.senderName,
    recipientName: params.recipientName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
  });

  return dispatchSMSToRecipients([params.recipientPhone], [params.recipientName], message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: 'checkin',
  });
}

/**
 * Sends a Loud Emergency Ping SMS alert to an individual member:
 * Primary: Supabase Cloud SMS API. Fallback: Native Device SMS.
 */
export async function sendLoudPingSMSToMember(
  params: SendMemberAlertSMSParams
): Promise<SendEmergencySMSResult> {
  const message = buildLoudPingSMSMessage({
    senderName: params.senderName,
    recipientName: params.recipientName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
  });

  return dispatchSMSToRecipients([params.recipientPhone], [params.recipientName], message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: 'loud_ping',
  });
}

/**
 * Sends a direct SMS to a specific phone number with custom body text.
 * Uses Cloud SMS API if online, falling back to Native Device SMS.
 */
export async function sendDirectSMS(phone: string, message: string): Promise<boolean> {
  const res = await dispatchSMSToRecipients([phone], ['Recipient'], message, {
    alertType: 'general',
  });
  return res.success;
}

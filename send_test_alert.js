/**
 * Single-Device Cloud Broadcast Tester
 * Sends an authentic remote emergency broadcast through Supabase
 * to test your phone without needing a 2nd device!
 *
 * Usage:
 *   node send_test_alert.js
 *   node send_test_alert.js --type checkin
 *   node send_test_alert.js --delay 5
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://vmunbhnmuuncaswpfqtc.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdW5iaG5tdXVuY2Fzd3BmcXRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzEzODksImV4cCI6MjA4NzU0NzM4OX0.bCY2V9aG8D0AFENiFTHQ3ozbgtCQcoXaMrkhf8n0T3A';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const args = process.argv.slice(2);
let alertType = 'loud_ping';
let delaySec = 0;
let senderName = 'NDRRMC / Family Circle';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--type' && args[i + 1]) {
    alertType = args[i + 1];
  } else if (args[i] === '--delay' && args[i + 1]) {
    delaySec = parseInt(args[i + 1], 10);
  } else if (args[i] === '--name' && args[i + 1]) {
    senderName = args[i + 1];
  }
}

console.log('----------------------------------------------------');
console.log('🚨 Abucay Guardian • Remote Emergency Alert Tester');
console.log(`Alert Type : ${alertType === 'loud_ping' ? 'LOUD EMERGENCY PING' : 'ARE YOU SAFE? (CHECK-IN)'}`);
console.log(`Sender Name: ${senderName}`);
console.log(`Delay      : ${delaySec} second(s)`);
console.log('----------------------------------------------------');

if (delaySec > 0) {
  console.log(`⏳ Waiting ${delaySec} seconds... (Minimize your app or lock your phone now!)`);
}

setTimeout(async () => {
  const channel = supabase.channel('family-broadcast');
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      console.log('📡 Connected to Supabase Cloud! Sending broadcast...');
      const eventName = alertType === 'loud_ping' ? 'loud_ping' : 'checkin_request';
      await channel.send({
        type: 'broadcast',
        event: eventName,
        payload: {
          from_user_id: 'simulator-remote-device',
          from_name: senderName,
          to_member_id: '', // Blank targets the circle
          sent_at: new Date().toISOString(),
        },
      });
      console.log(`✅ Broadcast "${eventName}" sent successfully!`);
      console.log('📱 Check your phone: The NDRRMC warning popup box / heads-up alert should appear!');
      setTimeout(() => process.exit(0), 1000);
    }
  });
}, delaySec * 1000);


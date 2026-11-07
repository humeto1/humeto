package com.humeto.tasks;

import android.app.Activity;
import android.speech.RecognizerIntent;
import android.content.ActivityNotFoundException;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.ArrayList;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.os.Build;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.PowerManager;
import android.app.PendingIntent;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import java.util.Locale;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HumetoDevice")
public class HumetoDevicePlugin extends Plugin {
 public static final int FOCUS_NOTIFICATION_ID = 2000000002;
 public static final String FOCUS_CHANNEL_ID = "humeto-focus-active-v1";

 @PluginMethod public void dictateInstruction(PluginCall call) {
  Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
  intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
  intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
  intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your instruction for Humeto");
  intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
  try {
   startActivityForResult(call, intent, "dictationResult");
  } catch (ActivityNotFoundException e) {
   call.reject("Speech recognition is unavailable on this device. Enable or install a speech recognition service.");
  } catch (Exception e) {
   call.reject("Unable to start speech recognition. Check your device speech and microphone settings.");
  }
 }

 @ActivityCallback private void dictationResult(PluginCall call, ActivityResult result) {
  if (call == null) return;
  JSObject response = new JSObject();
  String text = "";
  if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
   ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
   if (matches != null && !matches.isEmpty()) text = matches.get(0);
  }
  response.put("text", text.length() > 2000 ? text.substring(0, 2000) : text);
  call.resolve(response);
 }

 private void ensureFocusChannel() {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
   NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
   if (nm != null && nm.getNotificationChannel(FOCUS_CHANNEL_ID) == null) {
    NotificationChannel channel = new NotificationChannel(
     FOCUS_CHANNEL_ID,
     "Focus session timer",
     NotificationManager.IMPORTANCE_LOW
    );
    channel.setDescription("Ongoing focus timer display in notification bar");
    channel.setShowBadge(false);
    channel.enableVibration(false);
    channel.setSound(null, null);
    nm.createNotificationChannel(channel);
   }
  }
 }

 private int getNotificationSmallIcon() {
  int iconRes = getContext().getResources().getIdentifier("ic_stat_humeto", "drawable", getContext().getPackageName());
  if (iconRes == 0) {
   iconRes = getContext().getApplicationInfo().icon;
  }
  return iconRes;
 }

 private PendingIntent createOpenAppIntent() {
  Intent intent = new Intent(getContext(), MainActivity.class);
  intent.setAction(Intent.ACTION_VIEW);
  intent.setData(android.net.Uri.parse("humeto://focus"));
  intent.addCategory(Intent.CATEGORY_LAUNCHER);
  intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
  int flags = PendingIntent.FLAG_UPDATE_CURRENT;
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
   flags |= PendingIntent.FLAG_IMMUTABLE;
  }
  return PendingIntent.getActivity(getContext(), 0, intent, flags);
 }

 @PluginMethod public void quietChannel(PluginCall call) {
  if(Build.VERSION.SDK_INT>=26){
   String id=call.getString("id");
   if(id==null || !id.startsWith("humeto-quiet-")){call.reject("Invalid notification channel");return;}
   boolean vibrate=Boolean.TRUE.equals(call.getBoolean("vibration",false));
   NotificationChannel channel=new NotificationChannel(id,call.getString("name","Quiet reminders"),vibrate?NotificationManager.IMPORTANCE_DEFAULT:NotificationManager.IMPORTANCE_LOW);
   channel.setSound(null,null);channel.enableVibration(vibrate);channel.setVibrationPattern(vibrate?new long[]{0,100}:new long[]{0});
   ((NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(channel);
  }
  call.resolve();
 }
 @PluginMethod public void status(PluginCall call) {
  NotificationManager n=(NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  AudioManager audio=(AudioManager)getContext().getSystemService(Context.AUDIO_SERVICE);
  PowerManager power=(PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
  JSObject result=new JSObject();
  result.put("platform","Android");
  result.put("permission", n.areNotificationsEnabled()?"granted":"blocked");
  result.put("ringer",audio.getRingerMode()==AudioManager.RINGER_MODE_NORMAL?"normal":audio.getRingerMode()==AudioManager.RINGER_MODE_VIBRATE?"vibrate":"silent");
  result.put("notificationVolume",audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION));
  result.put("doNotDisturb",n.getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_ALL?"off":"active / restricted");
  result.put("batteryUnrestricted",power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
  result.put("notes","Channel settings and Do Not Disturb can silence sound or vibration. A granted permission alone does not guarantee an audible alert.");
  call.resolve(result);
 }
 @PluginMethod public void settings(PluginCall call) {
  Intent intent=new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
  intent.putExtra(Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());
  getActivity().startActivity(intent);
  call.resolve();
 }

 @PluginMethod public void updateFocusNotification(PluginCall call) {
  NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  if (nm == null || !nm.areNotificationsEnabled()) {
   call.resolve();
   return;
  }
  ensureFocusChannel();

  String title = call.getString("title", "Focus session");
  String state = call.getString("state", "running");
  int targetMinutes = call.getInt("targetMinutes", 25);
  long remainingSeconds = call.getData().optLong("remainingSeconds", 0L);
  long checkInAt = call.getData().optLong("checkInAt", 0L);
  long breakUntil = call.getData().optLong("breakUntil", 0L);

  NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), FOCUS_CHANNEL_ID)
   .setSmallIcon(getNotificationSmallIcon())
   .setColor(0xFF234C3B)
   .setContentIntent(createOpenAppIntent())
   .setOnlyAlertOnce(true)
   .setSilent(true)
   .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
   .setSubText("Focus session");

  if ("break".equals(state) && breakUntil > System.currentTimeMillis()) {
   builder.setContentTitle("Break · " + title)
    .setContentText("Taking a break · Tap to return")
    .setOngoing(true)
    .setShowWhen(true)
    .setUsesChronometer(true)
    .setTimeoutAfter(Math.max(1, breakUntil - System.currentTimeMillis()))
    .setWhen(breakUntil)
    .setCategory(NotificationCompat.CATEGORY_STOPWATCH);
   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
    builder.setChronometerCountDown(true);
   }
  } else if ("running".equals(state)) {
   long targetTime = checkInAt > 0 ? checkInAt : (System.currentTimeMillis() + Math.max(0, remainingSeconds) * 1000);
   if (targetTime > System.currentTimeMillis()) {
    builder.setContentTitle("Focusing · " + title)
     .setContentText(targetMinutes + " min estimate · Tap to return")
     .setOngoing(true)
     .setShowWhen(true)
     .setUsesChronometer(true)
     .setTimeoutAfter(Math.max(1, targetTime - System.currentTimeMillis()))
     .setWhen(targetTime)
     .setCategory(NotificationCompat.CATEGORY_STOPWATCH);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
     builder.setChronometerCountDown(true);
    }
   } else {
    builder.setContentTitle("Focus check-in · " + title)
     .setContentText("Target time completed. Tap to return to Humeto.")
     .setOngoing(false)
     .setShowWhen(true)
     .setUsesChronometer(false);
   }
  } else if ("paused".equals(state)) {
   long remMin = Math.max(0, remainingSeconds) / 60;
   long remSec = Math.max(0, remainingSeconds) % 60;
   String timeStr = String.format(Locale.getDefault(), "%02d:%02d", remMin, remSec);
   builder.setContentTitle("Paused · " + title)
    .setContentText(timeStr + " remaining (" + targetMinutes + " min estimate) · Tap to return")
    .setOngoing(false)
    .setShowWhen(false)
    .setUsesChronometer(false);
  } else {
   nm.cancel(FOCUS_NOTIFICATION_ID);
   call.resolve();
   return;
  }

  String sessionId = call.getString("sessionId", "");
  if (!sessionId.isEmpty()) {
   try {
    String token=call.getString("sessionToken", "");
    if(token.matches("[A-Za-z0-9_-]{43}")) {
     javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");cipher.init(javax.crypto.Cipher.ENCRYPT_MODE,sessionKey());
     FocusActionReceiver.prefs(getContext()).edit().putString("iv",android.util.Base64.encodeToString(cipher.getIV(),2)).putString("value",android.util.Base64.encodeToString(cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)),2)).apply();
    }
   }catch(Exception ignored){}
   FocusActionReceiver.prefs(getContext()).edit().putString("sessionId", sessionId).putString("server", call.getString("server", "https://www.humeto.com")).apply();
   try {
    org.json.JSONObject active=new org.json.JSONObject().put("id",sessionId).put("title",title).put("state",state).put("attendance_due_at",call.getString("attendanceDueAt", "")).put("check_in_at",java.time.Instant.ofEpochMilli(checkInAt).toString());
    FocusActionReceiver.show(getContext(),active,call.getBoolean("attendancePrompt",false),null);
   } catch(Exception ignored) { nm.notify(FOCUS_NOTIFICATION_ID, builder.build()); }
  } else nm.notify(FOCUS_NOTIFICATION_ID, builder.build());
  call.resolve();
 }

 @PluginMethod public void performFocusAction(PluginCall call) {
  String action=call.getString("action", "");String id=call.getString("sessionId", "");
  if(!java.util.Arrays.asList("pause","resume","stop","complete","confirm","check","timeout").contains(action)||!id.equals(FocusActionReceiver.prefs(getContext()).getString("sessionId",""))){call.reject("Focus session unavailable");return;}
  getContext().sendBroadcast(new Intent(getContext(),FocusActionReceiver.class).setAction("humeto.focus."+action).putExtra("sessionId",id));call.resolve();
 }
 @PluginMethod public void clearFocusNotification(PluginCall call) {
  NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
  if (nm != null) {
   nm.cancel(FOCUS_NOTIFICATION_ID);
  }
  FocusActionReceiver.cancel(getContext());
  FocusActionReceiver.prefs(getContext()).edit().clear().apply();
  call.resolve();
 }

 private javax.crypto.SecretKey sessionKey() throws Exception {
  java.security.KeyStore store = java.security.KeyStore.getInstance("AndroidKeyStore");
  store.load(null);
  String alias = "humeto-session-v1";
  if (!store.containsAlias(alias)) {
   javax.crypto.KeyGenerator generator = javax.crypto.KeyGenerator.getInstance("AES", "AndroidKeyStore");
   generator.init(new android.security.keystore.KeyGenParameterSpec.Builder(alias,
    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
    .setBlockModes("GCM").setEncryptionPaddings("NoPadding").build());
   generator.generateKey();
  }
  return (javax.crypto.SecretKey) store.getKey(alias, null);
 }
 private android.content.SharedPreferences sessionStorage() {
  return getContext().getSharedPreferences("humeto-private-session", Context.MODE_PRIVATE);
 }
 @PluginMethod public void saveSession(PluginCall call) {
  try {
   String token = call.getString("token", "");
   if (!token.matches("[A-Za-z0-9_-]{43}")) { call.reject("Invalid session"); return; }
   javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
   cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, sessionKey());
   String iv = android.util.Base64.encodeToString(cipher.getIV(), android.util.Base64.NO_WRAP);
   String encrypted = android.util.Base64.encodeToString(cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP);
   if (!sessionStorage().edit().putString("iv", iv).putString("value", encrypted).commit()) {
    call.reject("Could not save login"); return;
   }
   call.resolve();
  } catch (Exception e) { call.reject("Could not save login securely"); }
 }
 @PluginMethod public void readSession(PluginCall call) {
  JSObject result = new JSObject();
  try {
   String value = sessionStorage().getString("value", null);
   String iv = sessionStorage().getString("iv", null);
   if (value != null && iv != null) {
    javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(javax.crypto.Cipher.DECRYPT_MODE, sessionKey(), new javax.crypto.spec.GCMParameterSpec(128, android.util.Base64.decode(iv, android.util.Base64.NO_WRAP)));
    result.put("token", new String(cipher.doFinal(android.util.Base64.decode(value, android.util.Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
   }
  } catch (Exception e) { sessionStorage().edit().clear().commit(); }
  call.resolve(result);
 }
 @PluginMethod public void clearSession(PluginCall call) {
  if (!sessionStorage().edit().clear().commit()) { call.reject("Could not clear login"); return; }
  call.resolve();
 }
 private android.util.AtomicFile offlineFile() {
  return new android.util.AtomicFile(new java.io.File(getContext().getFilesDir(), "humeto-offline-v1"));
 }
 @PluginMethod public void readOffline(PluginCall call) {
  try {
   JSObject result = new JSObject();
   if (offlineFile().getBaseFile().exists()) {
    byte[] stored = offlineFile().readFully();
    org.json.JSONObject envelope = new org.json.JSONObject(new String(stored, java.nio.charset.StandardCharsets.UTF_8));
    javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(javax.crypto.Cipher.DECRYPT_MODE, sessionKey(), new javax.crypto.spec.GCMParameterSpec(128, android.util.Base64.decode(envelope.getString("iv"), android.util.Base64.NO_WRAP)));
    byte[] plain = cipher.doFinal(android.util.Base64.decode(envelope.getString("data"), android.util.Base64.NO_WRAP));
    result.put("value", new String(plain, java.nio.charset.StandardCharsets.UTF_8));
   }
   call.resolve(result);
  } catch (Exception e) { call.reject("Could not read offline data. It has not been deleted."); }
 }
 @PluginMethod public void saveOffline(PluginCall call) {
  java.io.FileOutputStream output = null;
  android.util.AtomicFile file = offlineFile();
  try {
   String value = call.getString("value", "");
   if (value.length() > 12000000) { call.reject("Offline storage is full. Connect to sync your changes."); return; }
   javax.crypto.Cipher cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
   cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, sessionKey());
   org.json.JSONObject envelope = new org.json.JSONObject();
   envelope.put("iv", android.util.Base64.encodeToString(cipher.getIV(), android.util.Base64.NO_WRAP));
   envelope.put("data", android.util.Base64.encodeToString(cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)), android.util.Base64.NO_WRAP));
   output = file.startWrite();
   output.write(envelope.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
   file.finishWrite(output);
   call.resolve();
  } catch (Exception e) { if (output != null) file.failWrite(output); call.reject("Could not save offline changes. Free some storage and try again."); }
 }

}

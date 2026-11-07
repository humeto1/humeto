package com.humeto.tasks;

import android.app.*;
import android.content.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;
import java.net.*;
import java.io.*;

/** Private, session-bound actions; server verifies current revisions and permissions. */
public class FocusActionReceiver extends BroadcastReceiver {
 static final String PREF="humeto-focus-actions";
 static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
 static PendingIntent intent(Context c,String action,String id){Intent i=new Intent(c,FocusActionReceiver.class).setAction("humeto.focus."+action).putExtra("sessionId",id);return PendingIntent.getBroadcast(c,action.hashCode(),i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static void schedule(Context c,String action,String id,long at){if(at<=0)return;AlarmManager a=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(a!=null){if(Build.VERSION.SDK_INT<31||a.canScheduleExactAlarms())a.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent(c,action,id));else a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,intent(c,action,id));}}
 static void cancel(Context c){AlarmManager a=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(a!=null){a.cancel(intent(c,"check",""));a.cancel(intent(c,"timeout",""));}}
 static String token(Context c)throws Exception{android.content.SharedPreferences s=c.getSharedPreferences("humeto-private-session",Context.MODE_PRIVATE);String iv=s.getString("iv",null),value=s.getString("value",null);if(iv==null||value==null){s=prefs(c);iv=s.getString("iv",null);value=s.getString("value",null);}if(iv==null||value==null)throw new Exception("Sign in to use focus controls");java.security.KeyStore k=java.security.KeyStore.getInstance("AndroidKeyStore");k.load(null);javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");cipher.init(javax.crypto.Cipher.DECRYPT_MODE,(javax.crypto.SecretKey)k.getKey("humeto-session-v1",null),new javax.crypto.spec.GCMParameterSpec(128,android.util.Base64.decode(iv,2)));return new String(cipher.doFinal(android.util.Base64.decode(value,2)),java.nio.charset.StandardCharsets.UTF_8);}
 static JSONObject api(Context c,String path,JSONObject body)throws Exception{
  String base=prefs(c).getString("server","https://www.humeto.com");
  if(!base.equals("https://www.humeto.com")&&!(c.getPackageName().endsWith(".qa")&&base.matches("http://10\\.0\\.2\\.2:[0-9]+")))throw new Exception("Invalid focus server");
  HttpURLConnection conn=(HttpURLConnection)new URL(base+path).openConnection();conn.setConnectTimeout(12000);conn.setReadTimeout(12000);conn.setInstanceFollowRedirects(false);conn.setRequestProperty("x-humeto-session",token(c));conn.setRequestProperty("Origin",base);conn.setRequestProperty("Content-Type","application/json");
  if(body!=null){conn.setRequestMethod("POST");conn.setDoOutput(true);try(OutputStream out=conn.getOutputStream()){out.write(body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
  int status=conn.getResponseCode();InputStream stream=status<400?conn.getInputStream():conn.getErrorStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(stream!=null)try(InputStream in=stream){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){bytes.write(b,0,n);if(bytes.size()>2000000)throw new Exception("Response too large");}}conn.disconnect();JSONObject result=new JSONObject(bytes.toString("UTF-8"));if(status>=400)throw new Exception(result.optString("error","Focus action failed"));return result;
 }
 static void show(Context c,JSONObject active,boolean check,String error){
  NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(nm==null)return;
  String state=active.optString("state"),id=active.optString("id"),title=active.optString("title","Focus task");
  if(active.has("ended_at")&&!active.isNull("ended_at")){nm.cancel(HumetoDevicePlugin.FOCUS_NOTIFICATION_ID);cancel(c);prefs(c).edit().remove("sessionId").apply();return;}
  String channel=HumetoDevicePlugin.FOCUS_CHANNEL_ID;
  if(check){channel="humeto-focus-attendance-v1";NotificationChannel ch=new NotificationChannel(channel,"Focus check-ins",NotificationManager.IMPORTANCE_HIGH);ch.enableVibration(true);ch.setVibrationPattern(new long[]{0,200,150,200});ch.setSound(null,null);nm.createNotificationChannel(ch);}
  PendingIntent open=PendingIntent.getActivity(c,23,new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  NotificationCompat.Builder b=new NotificationCompat.Builder(c,channel).setSmallIcon(c.getApplicationInfo().icon).setContentTitle((check?"Still working? · ":state.equals("running")?"Focusing · ":"Paused · ")+title).setContentText(error!=null?error:check?"Confirm within 1 minute or focus pauses.":"Focus controls").setContentIntent(open).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setOngoing(true).setOnlyAlertOnce(!check || active.optString("attendance_due_at").equals(prefs(c).getString("lastPrompt","")));
  if(check)prefs(c).edit().putString("lastPrompt",active.optString("attendance_due_at")).apply();
  if(state.equals("running")&&!check){try{long deadline=java.time.Instant.parse(active.optString("check_in_at")).toEpochMilli();if(deadline>System.currentTimeMillis())b.setWhen(deadline).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);}catch(Exception ignored){}}
  b.addAction(0,check?"Still working":state.equals("running")?"Pause":"Start",intent(c,check?"confirm":state.equals("running")?"pause":"resume",id));
  b.addAction(0,"Stop",intent(c,"stop",id));b.addAction(0,"Complete",intent(c,"complete",id));
  Intent profitIntent=new Intent(c,FocusActionReceiver.class).setAction("humeto.focus.profit").putExtra("sessionId",id);
  PendingIntent profit=PendingIntent.getBroadcast(c,445,profitIntent,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0));
  b.addAction(new NotificationCompat.Action.Builder(0,"Profit received",profit).addRemoteInput(new androidx.core.app.RemoteInput.Builder("profit").setLabel("Received amount ("+active.optString("value_currency","PKR")+")").build()).build());
  nm.notify(HumetoDevicePlugin.FOCUS_NOTIFICATION_ID,b.build());
  prefs(c).edit().putString("sessionId",id).putString("active",active.toString()).apply();
  if(state.equals("running")){long due=0;try{due=java.time.Instant.parse(active.optString("attendance_due_at")).toEpochMilli();}catch(Exception ignored){}if(check)schedule(c,"timeout",id,due>0?Math.max(System.currentTimeMillis()+1000,due+60000):System.currentTimeMillis()+60000);else schedule(c,"check",id,due);}else cancel(c);
 }
 @Override public void onReceive(Context c,Intent intent){String id=intent.getStringExtra("sessionId"),action=intent.getAction();if(id==null||!id.equals(prefs(c).getString("sessionId",""))||action==null)return;String act=action.substring(action.lastIndexOf('.')+1);PendingResult pending=goAsync();new Thread(()->{try{
  JSONObject data=api(c,"/api/workspace/focus",null),active=data.optJSONObject("active");if(active==null||!id.equals(active.optString("id"))){((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(HumetoDevicePlugin.FOCUS_NOTIFICATION_ID);cancel(c);return;}
  if(act.equals("profit")){
   Bundle input=androidx.core.app.RemoteInput.getResultsFromIntent(intent);if(input==null)return;String amount=String.valueOf(input.getCharSequence("profit", "")).trim();if(!amount.matches("[0-9]{1,9}(\\.[0-9]{1,2})?"))throw new Exception("Enter a valid received amount");
   String key="profit-"+id+"-"+amount;String receiptId=prefs(c).getString(key,null);if(receiptId==null){receiptId=java.util.UUID.randomUUID().toString();prefs(c).edit().putString(key,receiptId).apply();}JSONObject receipt=new JSONObject().put("id",receiptId).put("taskId",active.getString("task_id")).put("sessionId",id).put("amount",amount).put("currency",active.optString("value_currency","PKR")).put("day",java.time.LocalDate.now().toString());api(c,"/api/work-profit",receipt);prefs(c).edit().remove(key).apply();show(c,active,false,"Profit receipt saved");return;
  }
  if(act.equals("check")){show(c,active,active.optString("state").equals("running"),null);return;}
  if(act.equals("timeout")){show(c,active,false,null);return;}
  JSONObject body=new JSONObject().put("action",act).put("sessionId",id).put("revision",active.getLong("revision")).put("taskRevision",active.getLong("task_revision")).put("minutes",active.optInt("target_minutes",30));api(c,"/api/workspace/focus",body);
  JSONObject next=api(c,"/api/workspace/focus",null).optJSONObject("active");if(next==null){((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(HumetoDevicePlugin.FOCUS_NOTIFICATION_ID);cancel(c);prefs(c).edit().remove("sessionId").apply();}else show(c,next,false,null);
 }catch(Exception e){try{JSONObject active=new JSONObject(prefs(c).getString("active","{}"));show(c,active,false,"Could not sync. Open Humeto to retry.");}catch(Exception ignored){}}finally{pending.finish();}}).start();}
}

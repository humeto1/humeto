package com.humeto.tasks;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "HumetoDevice")
public class HumetoDevicePlugin extends Plugin {
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
}

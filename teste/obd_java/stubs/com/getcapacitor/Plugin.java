package com.getcapacitor;
import android.content.Context;
import androidx.annotation.NonNull;
public class Plugin {
  public Context getContext() { return null; }
  public PermissionState getPermissionState(String alias) { return null; }
  protected void requestPermissionForAlias(@NonNull String alias, @NonNull PluginCall call, @NonNull String cb) {}
  protected void handleOnDestroy() {} }

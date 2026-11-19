package com.getcapacitor;
import androidx.annotation.Nullable;
public class PluginCall {
  public String getString(String name) { return null; }
  public String getString(String name, @Nullable String d) { return null; }
  public Integer getInt(String name) { return null; }
  public Integer getInt(String name, @Nullable Integer d) { return d; }
  public void resolve(JSObject data) {} public void resolve() {}
  public void reject(String msg) {} }

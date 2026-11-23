package org.json;
import java.util.Iterator;
public class JSONObject {
  public JSONObject() {} public JSONObject(String s) throws JSONException {}
  public JSONObject(JSONObject o, String[] n) throws JSONException {}
  public JSONObject put(String k, Object v) throws JSONException { return this; }
  public JSONObject put(String k, boolean v) throws JSONException { return this; }
  public JSONObject put(String k, int v) throws JSONException { return this; }
  public JSONObject put(String k, long v) throws JSONException { return this; }
  public JSONObject put(String k, double v) throws JSONException { return this; }
  public Object get(String k) throws JSONException { return null; }
  public Object opt(String k) { return null; }
  public String getString(String k) throws JSONException { return null; }
  public boolean has(String k) { return false; }
  public void remove(String k) {}
  public Iterator<String> keys() { return null; }
  public int length() { return 0; }
  public String toString() { return ""; }
  public String toString(int i) throws JSONException { return ""; }
  public static String numberToString(Number n) throws JSONException { return ""; }
  public boolean isNull(String k) { return false; }
  public int getInt(String k) throws JSONException { return 0; }
  public boolean getBoolean(String k) throws JSONException { return false; }
  public double getDouble(String k) throws JSONException { return 0; }
  public long getLong(String k) throws JSONException { return 0; }
  public JSONArray names() { return null; }
}

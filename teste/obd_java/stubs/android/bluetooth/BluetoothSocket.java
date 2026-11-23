package android.bluetooth;
import java.io.*;
public class BluetoothSocket implements Closeable {
  public void connect() throws IOException {} public boolean isConnected() { return false; }
  public InputStream getInputStream() throws IOException { return null; }
  public OutputStream getOutputStream() throws IOException { return null; }
  public void close() throws IOException {} }

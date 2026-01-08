// XRPL client connection pool/reuse mechanism
import xrpl from "xrpl";

let clientInstance = null;
let connectionPromise = null;

const XRPL_TESTNET_URL = "wss://s.altnet.rippletest.net:51233";

/**
 * Get or create a shared XRPL client connection
 * Reuses existing connection to avoid repeated connect/disconnect overhead
 */
export async function getClient() {
  // If we have a connected client, return it
  if (clientInstance && clientInstance.isConnected()) {
    return clientInstance;
  }

  // If connection is in progress, wait for it
  if (connectionPromise) {
    return connectionPromise;
  }

  // Create new connection
  connectionPromise = (async () => {
    try {
      const client = new xrpl.Client(XRPL_TESTNET_URL);
      await client.connect();
      clientInstance = client;
      
      // Handle disconnection - clear instance so we reconnect next time
      client.on("disconnected", () => {
        clientInstance = null;
        connectionPromise = null;
      });

      connectionPromise = null;
      return client;
    } catch (err) {
      connectionPromise = null;
      throw err;
    }
  })();

  return connectionPromise;
}

/**
 * Disconnect the shared client (use sparingly - prefer to keep connection alive)
 */
export async function disconnectClient() {
  if (clientInstance && clientInstance.isConnected()) {
    await clientInstance.disconnect();
  }
  clientInstance = null;
  connectionPromise = null;
}

/**
 * Execute a function with a client connection, handling cleanup if needed
 * Use this for operations that might need a fresh connection
 */
export async function withClient(fn) {
  const client = await getClient();
  try {
    return await fn(client);
  } catch (err) {
    // If connection error, try to reconnect once
    if (err.message?.includes("disconnected") || err.message?.includes("connection")) {
      await disconnectClient();
      const newClient = await getClient();
      return await fn(newClient);
    }
    throw err;
  }
}

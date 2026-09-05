import { apiFetch, type NexusUser } from "@/lib/nexus-api";

// WebAuthn (passkey) client. The server speaks the SimpleWebAuthn JSON dialect: every binary field
// travels as a base64url string, while `navigator.credentials` insists on ArrayBuffers. So the two
// converters below are the whole job — decode what the server sends, encode what the device signs.
// Deliberately dependency-free: adding @simplewebauthn/browser would touch the lockfile.

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type CredentialDescriptorJSON = { id: string; type?: string; transports?: string[] };

type RegistrationOptionsJSON = {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: CredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteria;
};

type AuthenticationOptionsJSON = {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: CredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
};

function toDescriptors(list?: CredentialDescriptorJSON[]): PublicKeyCredentialDescriptor[] | undefined {
  return list?.map((c) => ({
    id: fromBase64Url(c.id),
    type: "public-key",
    transports: c.transports as AuthenticatorTransport[] | undefined,
  }));
}

/** False on browsers without WebAuthn — every passkey button hides behind this. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials?.create;
}

// Dismissing the system sheet (Escape, "Cancel", or a timeout) is a normal choice, not a failure —
// callers get `false` back and show nothing red.
function isCancellation(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
}

/** Add a passkey to the signed-in account. Returns false when the prompt was dismissed. */
export async function registerPasskey(label?: string): Promise<boolean> {
  const options = await apiFetch<RegistrationOptionsJSON>("/api/auth/passkey/register/options", { method: "POST" });

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rp: options.rp,
        user: { ...options.user, id: fromBase64Url(options.user.id) },
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation,
        excludeCredentials: toDescriptors(options.excludeCredentials),
        authenticatorSelection: options.authenticatorSelection,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) return false;
    // The browser refuses to enrol a device that already holds a passkey for this account.
    if (err instanceof DOMException && err.name === "InvalidStateError") throw new Error("This device already has a passkey for NEXUS.");
    throw err;
  }
  if (!credential) return false;

  const response = credential.response as AuthenticatorAttestationResponse;
  await apiFetch<{ ok: boolean }>("/api/auth/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({
      credential: {
        id: credential.id,
        rawId: toBase64Url(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: toBase64Url(response.clientDataJSON),
          attestationObject: toBase64Url(response.attestationObject),
          transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
        },
      },
      // Echo the server's own base64url string, never the decoded bytes — it looks the challenge up by it.
      challenge: options.challenge,
      label: label?.trim() || undefined,
    }),
  });
  return true;
}

/** Sign in with a passkey. On success the server has already set the session cookie. */
export async function signInWithPasskey(): Promise<{ ok: boolean; user?: NexusUser }> {
  const options = await apiFetch<AuthenticationOptionsJSON>("/api/auth/passkey/login/options", { method: "POST" });

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        timeout: options.timeout,
        rpId: options.rpId,
        allowCredentials: toDescriptors(options.allowCredentials),
        userVerification: options.userVerification,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancellation(err)) return { ok: false };
    throw err;
  }
  if (!credential) return { ok: false };

  const response = credential.response as AuthenticatorAssertionResponse;
  const result = await apiFetch<{ ok: boolean; user?: NexusUser }>("/api/auth/passkey/login/verify", {
    method: "POST",
    body: JSON.stringify({
      credential: {
        id: credential.id,
        rawId: toBase64Url(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: toBase64Url(response.clientDataJSON),
          authenticatorData: toBase64Url(response.authenticatorData),
          signature: toBase64Url(response.signature),
          userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
        },
      },
      challenge: options.challenge,
    }),
  });
  return { ok: !!result.ok, user: result.user };
}

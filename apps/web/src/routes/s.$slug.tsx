import { createFileRoute } from "@tanstack/react-router";
import { VaultSharePage, validateShareSearch } from "./v.$slug";

// The external half of Z Vault sharing. Same page, same API, different prefix — and the prefix is
// the whole point: /s/* is deliberately absent from the apple-app-site-association file, so a link
// sent to a client never launches the NEXUS app on a phone where they have no account and could
// only be shown a sign-in screen. Apple matches on the path alone, so this is the only way to say it.
export const Route = createFileRoute("/s/$slug")({ component: VaultSharePage, validateSearch: validateShareSearch });

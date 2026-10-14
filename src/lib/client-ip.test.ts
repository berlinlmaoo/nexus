import { describe, it, expect } from "vitest"
import { clientIpFromHeaders, displayableIp, isPrivateIp, normalizeIp } from "@/lib/client-ip"

// Documentation ranges only (RFC 5737 / RFC 3849) for "public" addresses.
const PUB_A = "203.0.113.7"
const PUB_B = "198.51.100.23"
const PUB_V6 = "2001:db8::42"

function h(map: Record<string, string>) {
  return new Headers(map)
}

describe("normalizeIp", () => {
  it("strips ports, brackets, zone ids and the IPv4-mapped prefix", () => {
    expect(normalizeIp(` ${PUB_A}:51000 `)).toBe(PUB_A)
    expect(normalizeIp(`[${PUB_V6}]:443`)).toBe(PUB_V6)
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1")
    expect(normalizeIp(`::ffff:${PUB_B}`)).toBe(PUB_B)
    expect(normalizeIp("2001:DB8::42")).toBe(PUB_V6)
  })
  it("rejects what is not an address", () => {
    expect(normalizeIp("unknown")).toBeNull()
    expect(normalizeIp("")).toBeNull()
    expect(normalizeIp("999.1.1.1")).toBeNull()
    expect(normalizeIp("example.test")).toBeNull()
    expect(normalizeIp(null)).toBeNull()
  })
})

describe("isPrivateIp", () => {
  it("flags local-network, loopback, link-local and CGNAT ranges", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.10", "127.0.0.1", "169.254.1.1", "100.64.0.1", "100.127.255.1", "0.0.0.0", "::1", "fd00::1", "fc12::9", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it("leaves public addresses alone", () => {
    for (const ip of [PUB_A, PUB_B, PUB_V6, "172.15.0.1", "172.32.0.1", "100.128.0.1", "192.169.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe("clientIpFromHeaders", () => {
  it("a public direct peer is the client, whatever else the request claims", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": PUB_A, "x-forwarded-for": `${PUB_B}, ${PUB_A}`, "cf-connecting-ip": PUB_B }))).toBe(PUB_A)
  })

  it("behind our own private hop, the CDN's client header wins", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "172.20.0.1", "cf-connecting-ip": PUB_A, "x-forwarded-for": `${PUB_A}, 172.20.0.1` }))).toBe(PUB_A)
  })

  it("walks X-Forwarded-For from the right and skips private hops (the proxy address is never the answer)", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "172.20.0.1", "x-forwarded-for": `${PUB_A}, 172.20.0.1` }))).toBe(PUB_A)
    expect(clientIpFromHeaders(h({ "x-forwarded-for": `${PUB_A}, 10.0.0.5, 127.0.0.1` }))).toBe(PUB_A)
  })

  it("does not take the client-written left-most hop on trust", () => {
    // The client sent "X-Forwarded-For: <spoof>"; the edge appended the real address.
    expect(clientIpFromHeaders(h({ "x-real-ip": "10.0.0.2", "x-forwarded-for": `${PUB_B}, ${PUB_A}, 10.0.0.2` }))).toBe(PUB_A)
  })

  it("an all-private chain is a local-network client: the left-most hop", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "172.20.0.1", "x-forwarded-for": "192.168.1.20, 172.20.0.1" }))).toBe("192.168.1.20")
  })

  it("falls back to the peer, then to null", () => {
    expect(clientIpFromHeaders(h({ "x-real-ip": "172.20.0.1" }))).toBe("172.20.0.1")
    expect(clientIpFromHeaders(h({}))).toBeNull()
    expect(clientIpFromHeaders(null)).toBeNull()
  })

  it("ignores junk entries", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": `unknown, not-an-ip, ${PUB_A}:1234` }))).toBe(PUB_A)
  })
})

describe("displayableIp", () => {
  it("shows public addresses only", () => {
    expect(displayableIp(PUB_A)).toBe(PUB_A)
    expect(displayableIp("172.20.0.1")).toBeNull()
    expect(displayableIp("192.168.1.20")).toBeNull()
    expect(displayableIp(null)).toBeNull()
  })
})

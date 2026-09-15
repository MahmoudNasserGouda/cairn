/**
 * Test environment for the `app` project (see vitest.config.ts).
 *
 * Angular's TestBed needs a platform before any service can be injected, and jsdom
 * ships no IndexedDB — so services that persist are given an in-memory store in
 * their own tests rather than a global shim.
 */
import '@angular/compiler';
import { webcrypto } from 'node:crypto';
import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

@NgModule({ providers: [provideZonelessChangeDetection()] })
class ZonelessTestModule {}

getTestBed().initTestEnvironment(
  [BrowserTestingModule, ZonelessTestModule],
  platformBrowserTesting(),
);

/**
 * jsdom implements `crypto.getRandomValues` but not `crypto.subtle`, so anything doing
 * real cryptography — PKCE's SHA-256 challenge (ADR-0034) — finds `subtle` undefined.
 *
 * Node's WebCrypto is the same standard interface a browser exposes, so this is filling
 * a gap in the test environment rather than substituting behaviour: the code under test
 * runs the real digest and is checked against RFC 7636's published vector.
 */
if (globalThis.crypto?.subtle === undefined) {
  // `node:crypto` is outside this project's `types`, so the import resolves untyped.
  // The cast names what it actually is rather than widening the lint rule.
  const { subtle } = webcrypto as unknown as { subtle: SubtleCrypto };
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: subtle,
    configurable: true,
  });
}

/**
 * Test environment for the `app` project (see vitest.config.ts).
 *
 * Angular's TestBed needs a platform before any service can be injected, and jsdom
 * ships no IndexedDB — so services that persist are given an in-memory store in
 * their own tests rather than a global shim.
 */
import '@angular/compiler';
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

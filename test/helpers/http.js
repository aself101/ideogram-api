/**
 * fetch test double for the v2 tests.
 *
 * The client calls the global fetch (axios was removed 2026-11-22), so tests
 * stub it and read back what was sent. `sentConfig()` normalizes a call into
 * the shape the tests assert on: url, method, headers, data (the parsed JSON
 * body, or the FormData instance) and timeout (the ms passed to
 * AbortSignal.timeout for that request).
 */

import { vi, expect, onTestFinished } from 'vitest';

export const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

export const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

/**
 * A Response stand-in whose body is rebuilt on every read, so one value given
 * to mockReturnValue can answer many calls (a real Response body reads once).
 */
export function fakeResponse(status, data, contentType = 'application/json') {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    get body() {
      return new Response(text).body;
    },
  };
}

export const ok = (data) => Promise.resolve(fakeResponse(200, data));
export const httpError = (status, data) => Promise.resolve(fakeResponse(status, data));

export function resetHttp() {
  fetchMock.mockReset();
  timeoutSpy.mockClear();
}

function toConfig([url, init = {}], timeout) {
  const body = init.body;
  return {
    url,
    method: init.method,
    headers: init.headers ?? {},
    data: typeof body === 'string' ? JSON.parse(body) : body,
    redirect: init.redirect,
    timeout,
  };
}

/** The single fetch call the client made. */
export function sentConfig() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return toConfig(fetchMock.mock.calls[0], timeoutSpy.mock.calls.at(-1)?.[0]);
}

/** Every text value of the multipart field `name`. */
export function formFields(config, name) {
  return config.data.getAll(name).filter((v) => typeof v === 'string');
}

/** Filename and Content-Type of every file part named `name`. */
export function fileParts(config, name) {
  return config.data
    .getAll(name)
    .filter((v) => typeof v !== 'string')
    .map((f) => ({ filename: f.name, contentType: f.type }));
}

/** The distinct field names in a multipart body, in order. */
export function formNames(config) {
  return [...new Set(config.data.keys())];
}

/** Spy on a client's request path to read the options each call passed (e.g. maxBodyBytes). */
export function spyRequests(api) {
  return vi.spyOn(api, '_request');
}

/**
 * Make setTimeout run its callback at once for the rest of the current test, and return the
 * list of delays it was asked for. waitForGeneration backs off 1 s, 2 s, 4 s ... between
 * retried polls (a 429 or another transient failure); this keeps those tests fast and lets
 * them assert the delays. Restored when the test finishes.
 */
export function instantSleeps() {
  const sleeps = [];
  const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
    sleeps.push(ms);
    fn();
    return 0;
  });
  onTestFinished(() => spy.mockRestore());
  return sleeps;
}

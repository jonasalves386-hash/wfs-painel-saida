'use strict';

const fs = require('node:fs');
const path = require('node:path');

class MalhaProvider {
  constructor({
    client, logger = console, staleAfterMs = 120000, waitWhenOlderThanMs = 15 * 60 * 1000,
    now = () => Date.now(), cachePath = '',
  } = {}) {
    this.client = client;
    this.logger = logger;
    this.staleAfterMs = staleAfterMs;
    this.waitWhenOlderThanMs = waitWhenOlderThanMs;
    this.now = now;
    this.cachePath = cachePath;
    this.cachedSnapshot = null;
    this.cacheUpdatedAt = 0;
    this.refreshPromise = null;
    this.restoreCache();
  }

  isConfigured() {
    return Boolean(this.client?.isConfigured());
  }

  restoreCache() {
    if (!this.cachePath) return;
    try {
      const payload = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (!Array.isArray(payload?.snapshot) || !Number.isFinite(payload?.savedAt)) return;
      this.cachedSnapshot = payload.snapshot;
      this.cacheUpdatedAt = payload.savedAt;
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger.warn('[saidas] Cache local da Malha inválido; aguardando novo snapshot.');
    }
  }

  persistCache() {
    if (!this.cachePath) return;
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({
        savedAt: this.cacheUpdatedAt,
        snapshot: this.cachedSnapshot,
      }));
    } catch {
      this.logger.warn('[saidas] Não foi possível persistir o cache local da Malha.');
    }
  }

  async loadSnapshot() {
    const snapshot = await this.client.getFlightsSnapshot();
    this.cachedSnapshot = snapshot;
    this.cacheUpdatedAt = this.now();
    this.persistCache();
    return this.cachedSnapshot;
  }

  refresh() {
    if (!this.refreshPromise) {
      this.refreshPromise = this.loadSnapshot().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async getFlightsSnapshot() {
    if (!this.cachedSnapshot) return this.refresh();

    // Cache muito antigo (ex.: restaurado do disco após reinício) não tem os
    // PUSH_OUT recentes: aguarda a Malha e só recorre a ele se a Malha falhar.
    if (this.now() - this.cacheUpdatedAt > this.waitWhenOlderThanMs) {
      try {
        return await this.refresh();
      } catch (error) {
        this.logger.error('[saidas] Atualização SIGA falhou; usando snapshot antigo.', error.code || error.name);
        return this.cachedSnapshot;
      }
    }

    void this.refresh().catch((error) => {
      this.logger.error('[saidas] Atualização SIGA falhou; mantendo último snapshot válido.', error.code || error.name);
    });
    return this.cachedSnapshot;
  }

  getCacheStatus() {
    return {
      available: Boolean(this.cachedSnapshot),
      stale: Boolean(this.cachedSnapshot) && this.now() - this.cacheUpdatedAt > this.staleAfterMs,
      updatedAt: this.cacheUpdatedAt ? new Date(this.cacheUpdatedAt).toISOString() : null,
    };
  }
}

module.exports = { MalhaProvider };

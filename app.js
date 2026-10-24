/**
 * CMUAlert frontend entry point.
 *
 * Loads directly from index.html, including when opened through file://.
 * Internal modules keep configuration, storage, credentials, and views separate.
 * Replace createDataService with a PHP API adapter when adding the backend.
 */
(async function () {
  'use strict';
  const __modules = Object.create(null);
  // 1. Configuration and workflow rules
  __modules['config'] = await (async function () {
    // Incident categories.
    const SYSTEM_TITLE =
      'CMUAlert: A Web-Based School Incident Reporting, Monitoring, and Announcement System for City of Malabon University';
    const ROLE_LABELS = Object.freeze({
      student: 'Student',
      faculty: 'Faculty / staff',
      admin: 'Administrator',
    });
    const roleLabel = (role) => ROLE_LABELS[role] || 'University member';
    const CATEGORIES = Object.freeze([
      {
        id: 'weapon',
        name: 'Weapon-Related Concerns',
        short: 'Weapon-related',
        icon: 'shield-alert',
        color: 'red',
        allowAnonymous: true,
        description: 'Weapons or potential weapon-related threats on campus.',
      },
      {
        id: 'bullying',
        name: 'Bullying',
        short: 'Bullying',
        icon: 'users',
        color: 'purple',
        allowAnonymous: true,
        description: 'Bullying or harassment within the university community.',
      },
      {
        id: 'property',
        name: 'Damaged School Property and Facilities',
        short: 'Property & facilities',
        icon: 'building',
        color: 'teal',
        allowAnonymous: true,
        description: 'Damaged school property, equipment, classrooms, or facilities.',
      },
    ]);
    // Keep previously saved reports readable, filterable, and included in real totals.
    const LEGACY_CATEGORIES = Object.freeze([
      {
        id: 'suspicious',
        name: 'Suspicious activities',
        short: 'Suspicious activity',
        icon: 'eye',
        color: 'amber',
        allowAnonymous: true,
        description: 'Previously reported suspicious activity.',
      },
      {
        id: 'conflict',
        name: 'Conflicts',
        short: 'Conflict',
        icon: 'users',
        color: 'blue',
        allowAnonymous: true,
        description: 'Previously reported campus conflict.',
      },
      {
        id: 'other',
        name: 'Other school-related concerns',
        short: 'Other concern',
        icon: 'report',
        color: 'slate',
        allowAnonymous: true,
        description: 'Another incident within CMU that affects school safety.',
      },
    ]);
    const ALL_CATEGORIES = Object.freeze([...CATEGORIES, ...LEGACY_CATEGORIES]);
    const STATUSES = Object.freeze([
      'Submitted',
      'Under Review',
      'In Progress',
      'Resolved',
      'Closed',
    ]);
    const TRANSITIONS = Object.freeze({
      'Submitted': ['Under Review'],
      'Under Review': ['In Progress'],
      'In Progress': ['Resolved'],
      'Resolved': ['Closed', 'In Progress'],
      'Closed': [],
    });
    // Retain existing announcement categories so saved records remain readable.
    const ANNOUNCEMENT_CATEGORIES = Object.freeze([
      'Emergency advisory',
      'Safety advisory',
      'Safety reminder',
      'Important notice',
      'General',
      'Campus update',
      'University event',
    ]);
    const AUDIENCES = Object.freeze([
      'University community',
      'All students',
      'Faculty and staff',
      'Administrators',
    ]);
    const isEmergencyAdvisory = (announcement) => announcement.category === 'Emergency advisory';
    const FILE_RULES = Object.freeze({
      types: ['image/jpeg', 'image/png'],
      maxFiles: 3,
      maxSize: 5 * 1024 * 1024,
    });
    // Older evidence remains readable; new incident uploads follow FILE_RULES.
    const LEGACY_FILE_RULES = Object.freeze({
      types: ['image/webp', 'application/pdf'],
      maxSize: 2 * 1024 * 1024,
    });
    const categoryById = (id) => ALL_CATEGORIES.find((c) => c.id === id);
    const reportableCategoryById = (id) => CATEGORIES.find((c) => c.id === id);

    return {
      SYSTEM_TITLE,
      ROLE_LABELS,
      roleLabel,
      CATEGORIES,
      LEGACY_CATEGORIES,
      ALL_CATEGORIES,
      STATUSES,
      TRANSITIONS,
      ANNOUNCEMENT_CATEGORIES,
      AUDIENCES,
      isEmergencyAdvisory,
      FILE_RULES,
      LEGACY_FILE_RULES,
      categoryById,
      reportableCategoryById,
    };
  })();
  // 2. Browser attachment storage (IndexedDB)
  __modules['attachments'] = await (async function () {
    const { FILE_RULES } = __modules['config'];

    function validateFiles(files) {
      if (files.length > FILE_RULES.maxFiles) throw new Error('Choose up to 3 photos.');
      for (const file of files) {
        if (!FILE_RULES.types.includes(file.type))
          throw new Error(`${file.name}: choose a JPG or PNG photo.`);
        if (!file.size || file.size > FILE_RULES.maxSize)
          throw new Error(`${file.name}: the photo must be between 1 byte and 5 MB.`);
      }
    }

    function createAttachmentStore() {
      let connection;
      const database = () => {
        if (!globalThis.indexedDB)
          return Promise.reject(
            new Error(
              'Your browser cannot store attachments. Remove the files or use a browser with IndexedDB.',
            ),
          );
        if (!connection)
          connection = new Promise((resolve, reject) => {
            const request = indexedDB.open('cmualert.prototype.files.v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('files');
            request.onsuccess = () => {
              request.result.onversionchange = () => {
                request.result.close();
                connection = null;
              };
              resolve(request.result);
            };
            request.onerror = () => {
              connection = null;
              reject(new Error('Attachment storage is unavailable. Remove the files and retry.'));
            };
            request.onblocked = () => {
              connection = null;
              reject(new Error('Attachment storage is busy. Close other CMUAlert tabs and retry.'));
            };
          });
        return connection;
      };
      async function transaction(mode, callback) {
        const db = await database();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('files', mode);
          let result;
          try {
            result = callback(tx.objectStore('files'));
          } catch (error) {
            reject(error);
            return;
          }
          tx.oncomplete = () => resolve(result?.result);
          tx.onabort = tx.onerror = () =>
            reject(
              new Error('Could not save or read the attachment. Browser storage may be full.'),
            );
        });
      }
      return {
        async putMany(entries) {
          if (entries.length)
            await transaction('readwrite', (store) => {
              for (const entry of entries) store.put(entry.file, entry.id);
            });
        },
        async get(id) {
          const blob = await transaction('readonly', (store) => store.get(id));
          if (!blob) throw new Error('This attachment is no longer available in this browser.');
          return blob;
        },
        async removeMany(ids) {
          if (ids.length)
            await transaction('readwrite', (store) => {
              for (const id of ids) store.delete(id);
            });
        },
        async clear() {
          if (globalThis.indexedDB) await transaction('readwrite', (store) => store.clear());
        },
      };
    }

    return { validateFiles, createAttachmentStore };
  })();
  // 3. Password hashing and credential verification
  __modules['credentials'] = await (async function () {
    // Local credential verifiers only. Production authentication belongs on the server.
    const ITERATIONS = 600000;
    const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
    const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    function validatePassword(password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128)
        throw new Error('Use a password between 8 and 128 characters.');
    }
    async function derive(password, salt, iterations) {
      if (!globalThis.crypto?.subtle)
        throw new Error(
          'This browser cannot create local password verifiers. Use a modern browser or open CMUAlert on localhost.',
        );
      const material = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      return new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
          material,
          256,
        ),
      );
    }
    async function createPasswordVerifier(password) {
      validatePassword(password);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      return {
        algorithm: 'PBKDF2-SHA256',
        iterations: ITERATIONS,
        salt: toBase64(salt),
        hash: toBase64(await derive(password, salt, ITERATIONS)),
      };
    }
    async function verifyPassword(password, verifier) {
      if (
        typeof password !== 'string' ||
        password.length > 128 ||
        verifier?.algorithm !== 'PBKDF2-SHA256' ||
        !Number.isInteger(verifier.iterations) ||
        verifier.iterations < 100000 ||
        verifier.iterations > 1000000
      )
        return false;
      try {
        const expected = fromBase64(verifier.hash);
        const actual = await derive(password, fromBase64(verifier.salt), verifier.iterations);
        let difference = actual.length ^ expected.length;
        for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ (expected[i] ?? 0);
        return difference === 0;
      } catch {
        return false;
      }
    }

    return { createPasswordVerifier, verifyPassword };
  })();
  // 4. Data service: records, accounts, sessions, and audit history
  __modules['data-service'] = await (async function () {
    const {
      ALL_CATEGORIES,
      STATUSES,
      TRANSITIONS,
      ANNOUNCEMENT_CATEGORIES,
      AUDIENCES,
      categoryById,
      reportableCategoryById,
      isEmergencyAdvisory,
      FILE_RULES,
      LEGACY_FILE_RULES,
    } = __modules['config'];
    const { validateFiles } = __modules['attachments'];
    const { createPasswordVerifier, verifyPassword } = __modules['credentials'];

    const STORAGE_KEY = 'cmualert.prototype.v1';
    const SESSION_KEY = 'cmualert.session.v1';
    const ACCOUNT_ROLES = Object.freeze(['student', 'faculty']);
    const AUDIT_ACTIONS = Object.freeze({
      'admin.provisioned': 'Initial administrator created',
      'account.registered': 'Account registered',
      'account.created': 'Account created by administrator',
      'account.updated': 'Account details changed',
      'account.role_changed': 'University role changed',
      'account.status_changed': 'Account access changed',
      'account.password_reset': 'Temporary password set',
      'account.password_changed': 'Password changed',
      'account.profile_updated': 'Profile updated',
      'account.reports_passcode_changed': 'My reports passcode changed',
      'auth.signed_in': 'Signed in',
      'auth.sign_in_failed': 'Sign-in failed',
      'auth.signed_out': 'Signed out',
      'auth.reauthentication_failed': 'Administrator verification failed',
      'incident.updated': 'Incident review updated',
      'announcement.created': 'Announcement draft created',
      'announcement.updated': 'Announcement updated',
      'announcement.published': 'Announcement published',
      'announcement.archived': 'Announcement archived',
    });
    const SESSION_DURATION = 8 * 60 * 60 * 1000;
    const ATTEMPT_WINDOW = 15 * 60 * 1000;
    class DataError extends Error {
      constructor(message, code = 'validation', field = '') {
        super(message);
        this.name = 'DataError';
        this.code = code;
        this.field = field;
      }
    }
    const clone = (value) => structuredClone(value);
    const required = (value, name, max = 5000) => {
      if (typeof value !== 'string' || !value.trim()) throw new DataError(`${name} is required.`);
      if (value.trim().length > max)
        throw new DataError(`${name} must be ${max} characters or fewer.`);
      return value.trim();
    };
    const optional = (value, name, max = 5000) => (value?.trim() ? required(value, name, max) : '');

    // Validate nested records before any view reads them. Invalid data stays untouched.
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = (value, max = 5000, empty = false) =>
      typeof value === 'string' && value.length <= max && (empty || Boolean(value.trim()));
    const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
    const instant = (value) =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      Number.isFinite(Date.parse(value));
    const versioned = (value) =>
      Number.isSafeInteger(value.version) &&
      value.version > 0 &&
      instant(value.createdAt) &&
      instant(value.updatedAt);
    const optionalActor = (entry) =>
      (entry.actor === undefined || text(entry.actor, 100, true)) &&
      (entry.actorId == null || identifier(entry.actorId));
    const savedEntry = (entry) =>
      object(entry) &&
      identifier(entry.id) &&
      text(entry.text) &&
      instant(entry.createdAt) &&
      optionalActor(entry);
    const entries = (value, validate) => Array.isArray(value) && value.every(validate);
    const unique = (rows, key) => new Set(rows.map(key)).size === rows.length;
    function validVerifier(verifier) {
      if (
        !object(verifier) ||
        verifier.algorithm !== 'PBKDF2-SHA256' ||
        !Number.isInteger(verifier.iterations) ||
        verifier.iterations < 100000 ||
        verifier.iterations > 1000000
      )
        return false;
      try {
        return (
          typeof verifier.salt === 'string' &&
          typeof verifier.hash === 'string' &&
          atob(verifier.salt).length === 16 &&
          atob(verifier.hash).length === 32
        );
      } catch {
        return false;
      }
    }
    function validReport(report) {
      if (
        !object(report) ||
        !identifier(report.id) ||
        !text(report.reference, 100) ||
        !categoryById(report.category) ||
        !STATUSES.includes(report.status) ||
        !['identified', 'anonymous'].includes(report.mode) ||
        !text(report.title, 120) ||
        !text(report.description) ||
        !text(report.location, 200, true) ||
        !versioned(report)
      )
        return false;
      if (
        typeof report.incidentDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(report.incidentDate) ||
        typeof report.incidentTime !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(report.incidentTime)
      )
        return false;
      const incident = new Date(report.incidentDate + 'T' + report.incidentTime + ':00');
      if (
        !Number.isFinite(incident.valueOf()) ||
        incident.getDate() !== Number(report.incidentDate.slice(8, 10)) ||
        incident.getMonth() + 1 !== Number(report.incidentDate.slice(5, 7))
      )
        return false;
      if (
        report.mode === 'anonymous'
          ? report.reporterId != null ||
            report.reporterName != null ||
            report.reporterRole != null ||
            !text(report.trackingReference, 100)
          : !identifier(report.reporterId) ||
            (report.reporterName != null && !text(report.reporterName, 80, true))
      )
        return false;
      if (report.submissionId !== undefined && !identifier(report.submissionId)) return false;
      if (
        !entries(
          report.history,
          (h) =>
            object(h) &&
            identifier(h.id) &&
            STATUSES.includes(h.status) &&
            instant(h.createdAt) &&
            text(h.message) &&
            optionalActor(h),
        ) ||
        !report.history.length ||
        report.history.at(-1).status !== report.status
      )
        return false;
      if (
        !entries(report.actions, savedEntry) ||
        !entries(report.internalNotes, savedEntry) ||
        !entries(report.reporterUpdates, savedEntry) ||
        (report.resolution != null && !savedEntry(report.resolution))
      )
        return false;
      return (
        entries(
          report.attachments,
          (a) =>
            object(a) &&
            typeof a.id === 'string' &&
            /^[a-zA-Z0-9_/-]{1,220}$/.test(a.id) &&
            text(a.name, 500) &&
            Number.isInteger(a.size) &&
            a.size > 0 &&
            ((FILE_RULES.types.includes(a.type) && a.size <= FILE_RULES.maxSize) ||
              (LEGACY_FILE_RULES.types.includes(a.type) && a.size <= LEGACY_FILE_RULES.maxSize)),
        ) && report.attachments.length <= FILE_RULES.maxFiles
      );
    }
    function validStoredState(state) {
      if (
        !object(state) ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0 ||
        !object(state.preferences) ||
        !identifier(state.preferences.reporterId) ||
        !text(state.preferences.displayName, 80, true)
      )
        return false;
      if (
        !entries(
          state.users,
          (u) =>
            object(u) &&
            identifier(u.id) &&
            text(u.name, 80) &&
            typeof u.username === 'string' &&
            /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(u.username) &&
            ['student', 'faculty', 'admin'].includes(u.role) &&
            versioned(u) &&
            validVerifier(u.password) &&
            ['active', 'disabled'].includes(u.status) &&
            Number.isSafeInteger(u.authVersion) &&
            u.authVersion > 0 &&
            typeof u.mustChangePassword === 'boolean' &&
            (u.contact === undefined ||
              (object(u.contact) &&
                text(u.contact.email, 120, true) &&
                text(u.contact.phone, 30, true))) &&
            (u.avatar === undefined || u.avatar === '' || validAvatar(u.avatar)) &&
            (u.reportsPasscode == null || validVerifier(u.reportsPasscode)) &&
            (u.passcodeAttempt === undefined ||
              (object(u.passcodeAttempt) &&
                Number.isInteger(u.passcodeAttempt.count) &&
                u.passcodeAttempt.count >= 0 &&
                u.passcodeAttempt.count <= 5 &&
                (u.passcodeAttempt.blockedUntil === null ||
                  instant(u.passcodeAttempt.blockedUntil)))),
        )
      )
        return false;
      const identity = (u) =>
        object(u) &&
        identifier(u.id) &&
        text(u.name, 80) &&
        text(u.username, 50) &&
        ['student', 'faculty', 'admin'].includes(u.role);
      if (
        !entries(
          state.auditLog,
          (e) =>
            object(e) &&
            identifier(e.id) &&
            Object.hasOwn(AUDIT_ACTIONS, e.action) &&
            instant(e.createdAt) &&
            (e.actor === null || identity(e.actor)) &&
            (e.target === null || identity(e.target)) &&
            text(e.reason, 500, true) &&
            (e.resource === undefined ||
              (object(e.resource) &&
                ['incident', 'announcement'].includes(e.resource.type) &&
                identifier(e.resource.id) &&
                text(e.resource.label, 160))) &&
            entries(
              e.changes,
              (c) =>
                object(c) &&
                ['name', 'username', 'role', 'status', 'email', 'phone'].includes(c.field) &&
                text(c.from, 120, true) &&
                text(c.to, 120, true),
            ),
        ) ||
        !unique(state.auditLog, (e) => e.id)
      )
        return false;
      if (
        !entries(
          state.sessions,
          (s) =>
            object(s) &&
            /^[a-f0-9]{64}$/.test(s.tokenHash) &&
            identifier(s.userId) &&
            Number.isSafeInteger(s.authVersion) &&
            s.authVersion > 0 &&
            instant(s.expiresAt) &&
            (s.reportsUnlockedUntil == null || instant(s.reportsUnlockedUntil)),
        ) ||
        !unique(state.sessions, (s) => s.tokenHash)
      )
        return false;
      if (
        !entries(
          state.loginAttempts,
          (a) =>
            object(a) &&
            (a.userId === null || identifier(a.userId)) &&
            Number.isInteger(a.count) &&
            a.count > 0 &&
            a.count <= 5 &&
            instant(a.windowStart) &&
            (a.blockedUntil === null || instant(a.blockedUntil)),
        ) ||
        !unique(state.loginAttempts, (a) => a.userId)
      )
        return false;
      if (!entries(state.reports, validReport)) return false;
      if (
        !entries(
          state.announcements,
          (a) =>
            object(a) &&
            identifier(a.id) &&
            text(a.title, 160) &&
            text(a.content, 10000) &&
            ['Draft', 'Published', 'Archived'].includes(a.status) &&
            ANNOUNCEMENT_CATEGORIES.includes(a.category) &&
            AUDIENCES.includes(a.audience) &&
            versioned(a) &&
            (a.pinned === undefined || typeof a.pinned === 'boolean') &&
            (a.publishedAt == null || instant(a.publishedAt)) &&
            (a.status !== 'Published' || instant(a.publishedAt)),
        )
      )
        return false;
      if (!validWorkspaceData(state)) return false;
      return (
        unique(state.users, (u) => u.id) &&
        unique(state.users, (u) => u.username.toLowerCase()) &&
        unique(state.reports, (r) => r.id) &&
        unique(state.reports, (r) => r.reference) &&
        unique(
          state.reports.filter((r) => r.mode === 'anonymous'),
          (r) => r.trackingReference,
        ) &&
        unique(state.announcements, (a) => a.id)
      );
    }

    function validAvatar(value) {
      return (
        typeof value === 'string' &&
        value.length <= 220000 &&
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
      );
    }
    // New collections are additive: browsers with older CMUAlert records keep those records.
    function validWorkspaceData(state) {
      const appearance = state.preferences.appearance;
      if (
        !object(appearance) ||
        !['light', 'dark'].includes(appearance.theme) ||
        !['small', 'medium', 'large'].includes(appearance.fontSize)
      )
        return false;
      if (
        !entries(
          state.preferences.accounts,
          (p) =>
            object(p) &&
            identifier(p.userId) &&
            typeof p.allowNotifications === 'boolean' &&
            (p.onboardingDismissed === undefined || typeof p.onboardingDismissed === 'boolean') &&
            entries(p.readActivity, (v) => text(v, 240)),
        ) ||
        !unique(state.preferences.accounts, (p) => p.userId)
      )
        return false;
      return (
        entries(
          state.conversations,
          (c) =>
            object(c) &&
            identifier(c.id) &&
            identifier(c.participantId) &&
            text(c.subject, 160) &&
            versioned(c) &&
            ['none', 'pending', 'approved', 'denied'].includes(c.replyStatus) &&
            entries(
              c.messages,
              (m) =>
                object(m) &&
                identifier(m.id) &&
                identifier(m.authorId) &&
                ['admin', 'student', 'faculty'].includes(m.authorRole) &&
                text(m.text) &&
                instant(m.createdAt),
            ) &&
            c.messages.length > 0 &&
            unique(c.messages, (m) => m.id) &&
            entries(
              c.readBy,
              (r) => object(r) && identifier(r.userId) && identifier(r.messageId),
            ) &&
            unique(c.readBy, (r) => r.userId),
        ) && unique(state.conversations, (c) => c.id)
      );
    }

    // The UI depends on this asynchronous repository contract, not on localStorage.
    // Replace this service when connecting a future backend.
    function createDataService({
      storage,
      sessionStorage,
      attachments,
      now = () => new Date(),
      id = () => crypto.randomUUID(),
      locks = globalThis.navigator?.locks,
    } = {}) {
      let initial;
      let memorySession = null;
      let cachedToken = null,
        cachedDigest = null,
        dummyVerifier;
      let queue = Promise.resolve();
      const listeners = new Set();
      const fresh = () => ({
        schemaVersion: 3,
        revision: 0,
        users: [],
        reports: [],
        announcements: [],
        conversations: [],
        auditLog: [],
        sessions: [],
        loginAttempts: [],
        preferences: {
          reporterId: id(),
          displayName: '',
          appearance: { theme: 'light', fontSize: 'medium' },
          accounts: [],
        },
      });
      const timestamp = () => now().toISOString();
      const emit = () => {
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            console.error('CMUAlert view refresh failed', error);
          }
        }
      };

      function read() {
        let raw;
        try {
          raw = storage.getItem(STORAGE_KEY);
        } catch {
          throw new DataError(
            'Browser storage is unavailable. Allow local storage to use CMUAlert.',
            'storage',
          );
        }
        if (raw === null) return clone((initial ??= fresh()));
        let state;
        try {
          state = JSON.parse(raw);
        } catch {
          throw new DataError(
            'Saved CMUAlert data could not be read. Download a copy before using Reset unreadable data to start again.',
            'corrupt',
          );
        }
        if (![1, 2, 3].includes(state?.schemaVersion))
          throw new DataError(
            'This browser contains an unsupported CMUAlert data version. It has been preserved; download a backup before resetting it.',
            'schema',
          );
        // Add accounts to the existing envelope without deleting or reassigning records.
        if (state.schemaVersion === 1) {
          state.schemaVersion = 2;
          state.users = [];
        }
        if (state.schemaVersion === 2) {
          // Preserve accounts and records. Old ID-only sessions require a new login.
          if (Array.isArray(state.users))
            state.users = state.users.map((u) =>
              object(u) ? { ...u, status: 'active', authVersion: 1, mustChangePassword: false } : u,
            );
          state.schemaVersion = 3;
          state.auditLog = [];
          state.sessions = [];
          state.loginAttempts = [];
        }
        if (object(state.preferences)) {
          if (!Object.hasOwn(state.preferences, 'appearance'))
            state.preferences.appearance = { theme: 'light', fontSize: 'medium' };
          if (!Object.hasOwn(state.preferences, 'accounts')) state.preferences.accounts = [];
        }
        if (!Object.hasOwn(state, 'conversations')) state.conversations = [];
        if (!validStoredState(state)) {
          throw new DataError(
            'Some saved CMUAlert records are invalid. Download a copy before using Reset unreadable data to recover.',
            'corrupt',
          );
        }
        return state;
      }
      function write(state) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
          throw new DataError(
            'Changes were not saved. Browser storage may be full or disabled. Your entered information is still available; free storage and retry.',
            'storage',
          );
        }
      }
      function mutate(callback) {
        const operation = async () => {
          const state = read();
          const result = await callback(state);
          if (read().revision !== state.revision)
            throw new DataError(
              'Records changed in another tab. Review the latest data and try again.',
              'conflict',
            );
          state.revision += 1;
          write(state);
          emit();
          return clone(result);
        };
        const run = () =>
          locks?.request ? locks.request('cmualert.prototype.write', operation) : operation();
        const next = queue.then(run, run);
        queue = next.catch(() => {});
        return next;
      }
      function publicReport(report, anonymous = false) {
        // Public responses deliberately omit stored administrator and internal metadata.
        const visible = {
          reference: report.reference,
          category: report.category,
          status: report.status,
          mode: report.mode,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
          history: report.history.map(({ status, createdAt, message }) => ({
            status,
            createdAt,
            message,
          })),
          reporterUpdates: report.reporterUpdates.map(({ text, createdAt }) => ({
            text,
            createdAt,
          })),
          resolution: report.resolution
            ? { text: report.resolution.text, createdAt: report.resolution.createdAt }
            : null,
        };
        if (!anonymous)
          Object.assign(visible, {
            id: report.id,
            title: report.title,
            description: report.description,
            location: report.location,
            incidentDate: report.incidentDate,
            incidentTime: report.incidentTime,
            attachments: clone(report.attachments),
          });
        return visible;
      }
      function getReport(state, reportId) {
        const report = state.reports.find((r) => r.id === reportId);
        if (!report) throw new DataError('This report could not be found.', 'not_found');
        return report;
      }
      const safeUser = ({ password, authVersion, reportsPasscode, passcodeAttempt, ...user }) =>
        clone({ ...user, hasReportsPasscode: Boolean(reportsPasscode) });
      const identity = (user) =>
        user ? { id: user.id, name: user.name, username: user.username, role: user.role } : null;
      function audit(state, action, actor, target, { reason = '', changes = [], resource } = {}) {
        state.auditLog.push({
          id: id(),
          action,
          actor: identity(actor),
          target: identity(target),
          createdAt: timestamp(),
          reason,
          changes: clone(changes),
          ...(resource ? { resource: clone(resource) } : {}),
        });
      }
      function sessionToken() {
        try {
          return sessionStorage ? sessionStorage.getItem(SESSION_KEY) : memorySession;
        } catch {
          throw new DataError(
            'The local sign-in session could not be read. Allow browser session storage and try again.',
            'storage',
          );
        }
      }
      function setSession(value) {
        try {
          if (sessionStorage)
            value
              ? sessionStorage.setItem(SESSION_KEY, value)
              : sessionStorage.removeItem(SESSION_KEY);
        } catch {
          throw new DataError(
            'Your sign-in session could not be saved. Allow browser session storage and try again.',
            'storage',
          );
        }
        memorySession = value;
      }
      const tokenDigest = async (token) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
          (b) => b.toString(16).padStart(2, '0'),
        ).join('');
      async function sessionDetails(state) {
        const token = sessionToken();
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
        if (token !== cachedToken) {
          cachedToken = token;
          cachedDigest = tokenDigest(token);
        }
        const digest = await cachedDigest;
        const session = state.sessions.find(
          (s) => s.tokenHash === digest && Date.parse(s.expiresAt) > now().valueOf(),
        );
        const user =
          session &&
          state.users.find(
            (u) =>
              u.id === session.userId &&
              u.authVersion === session.authVersion &&
              u.status === 'active',
          );
        return user ? { user, session } : null;
      }
      const sessionUser = async (state) => (await sessionDetails(state))?.user || null;
      async function requireUser(state, allowedRole, allowPasswordChange = false) {
        const user = await sessionUser(state);
        if (!user) throw new DataError('Sign in to your account to continue.', 'unauthenticated');
        if (allowedRole && user.role !== allowedRole)
          throw new DataError(
            'This action is available only in the administrator account.',
            'forbidden',
          );
        if (user.mustChangePassword && !allowPasswordChange)
          throw new DataError(
            'Change your temporary password before continuing.',
            'password_change_required',
          );
        return user;
      }
      async function requireReporter(state) {
        const user = await requireUser(state);
        if (!ACCOUNT_ROLES.includes(user.role))
          throw new DataError(
            'Only student and faculty / staff accounts can submit incident reports.',
            'forbidden',
          );
        return user;
      }
      function accountDetails(input) {
        const name = required(input.name, 'Full name', 80);
        const username = required(input.username, 'CMU ID or username', 50).toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,49}$/.test(username))
          throw new DataError(
            'Use 3–50 letters, numbers, dots, underscores, or hyphens for your username.',
          );
        return { name, username };
      }
      function passwordPolicy(password, accountRole) {
        if (accountRole === 'admin' && (typeof password !== 'string' || password.length < 15))
          throw new DataError('Use at least 15 characters for an administrator password.');
      }
      function revokeSessions(state, user) {
        user.authVersion++;
        state.sessions = state.sessions.filter((s) => s.userId !== user.id);
      }
      function blocked(state, userId) {
        return state.loginAttempts.some(
          (a) => a.userId === userId && Date.parse(a.blockedUntil) > now().valueOf(),
        );
      }
      function failedAttempt(state, userId) {
        let attempt = state.loginAttempts.find((a) => a.userId === userId);
        if (!attempt || now().valueOf() - Date.parse(attempt.windowStart) >= ATTEMPT_WINDOW) {
          state.loginAttempts = state.loginAttempts.filter((a) => a.userId !== userId);
          attempt = { userId, count: 0, windowStart: timestamp(), blockedUntil: null };
          state.loginAttempts.push(attempt);
        }
        attempt.count = Math.min(5, attempt.count + 1);
        if (attempt.count >= 5)
          attempt.blockedUntil = new Date(now().valueOf() + ATTEMPT_WINDOW).toISOString();
      }
      function managedAccount(state, accountId, expectedVersion) {
        const user = state.users.find((u) => u.id === accountId);
        if (!user) throw new DataError('This account could not be found.', 'not_found');
        if (user.role === 'admin')
          throw new DataError(
            'Administrator accounts can be changed only by their owner in Profile & settings.',
            'forbidden',
          );
        if (user.version !== expectedVersion)
          throw new DataError(
            'This account changed in another tab. Reopen it before saving.',
            'conflict',
          );
        return user;
      }
      async function verifyAdministrator(password) {
        const state = read();
        const actor = await requireUser(state, 'admin');
        if (blocked(state, actor.id))
          throw new DataError(
            'Too many failed verification attempts. Wait 15 minutes before trying again.',
            'credentials',
          );
        if (!(await verifyPassword(password, actor.password))) {
          await mutate(async (state) => {
            const current = await requireUser(state, 'admin');
            if (!blocked(state, current.id)) {
              failedAttempt(state, current.id);
              audit(state, 'auth.reauthentication_failed', current, current);
            }
          });
          throw new DataError(
            'Your administrator password is incorrect.',
            'credentials',
            'currentPassword',
          );
        }
        return actor;
      }
      async function confirmedAdministrator(state, actor) {
        const current = await requireUser(state, 'admin');
        if (current.id !== actor.id || current.version !== actor.version)
          throw new DataError(
            'Your administrator account changed. Sign in again before continuing.',
            'conflict',
          );
        if (blocked(state, current.id))
          throw new DataError(
            'Too many failed verification attempts. Wait 15 minutes before trying again.',
            'credentials',
          );
        state.loginAttempts = state.loginAttempts.filter((a) => a.userId !== current.id);
        return current;
      }
      async function createAccount(input, accountRole) {
        const { name, username } = accountDetails(input);
        if (input.password !== input.confirmPassword)
          throw new DataError('Passwords do not match.');
        passwordPolicy(input.password, accountRole);
        const password = await createPasswordVerifier(input.password);
        return mutate(async (state) => {
          if (accountRole === 'admin' && state.users.some((u) => u.role === 'admin'))
            throw new DataError(
              'An administrator account already exists in this browser. Sign in with that account.',
              'conflict',
            );
          if (state.users.some((u) => u.username.toLowerCase() === username))
            throw new DataError(
              'This CMU ID or username is already registered in this browser.',
              'conflict',
            );
          const user = {
            id: id(),
            name,
            username,
            role: accountRole,
            password,
            status: 'active',
            authVersion: 1,
            mustChangePassword: false,
            createdAt: timestamp(),
            updatedAt: timestamp(),
            version: 1,
          };
          state.users.push(user);
          audit(
            state,
            accountRole === 'admin' ? 'admin.provisioned' : 'account.registered',
            null,
            user,
          );
          return safeUser(user);
        });
      }
      function validateReport(input) {
        const category = reportableCategoryById(input.category);
        if (!category) throw new DataError('Choose an incident category.');
        const title = required(input.title, 'Incident title', 120);
        const description = required(input.description, 'Description', 5000);
        const location = optional(input.location, 'Location', 200);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(input.incidentDate) ||
          !/^\d{2}:\d{2}$/.test(input.incidentTime)
        )
          throw new DataError('Enter a valid incident date and time.');
        const date = new Date(`${input.incidentDate}T${input.incidentTime}:00`);
        if (
          Number.isNaN(date.valueOf()) ||
          date > now() ||
          date.getFullYear() < 2000 ||
          date.getDate() !== Number(input.incidentDate.slice(8, 10)) ||
          date.getMonth() + 1 !== Number(input.incidentDate.slice(5, 7))
        )
          throw new DataError('Enter a valid incident date and time that is not in the future.');
        if (!['identified', 'anonymous'].includes(input.mode))
          throw new DataError('Choose a reporting mode.');
        if (input.mode === 'anonymous' && !category.allowAnonymous)
          throw new DataError('Anonymous reporting is unavailable for this category.');
        return {
          category: category.id,
          title,
          description,
          location,
          incidentDate: input.incidentDate,
          incidentTime: input.incidentTime,
          mode: input.mode,
        };
      }
      function accountPreferences(state, userId) {
        return (
          state.preferences.accounts.find((p) => p.userId === userId) || {
            userId,
            allowNotifications: true,
            onboardingDismissed: false,
            readActivity: [],
          }
        );
      }
      function saveAccountPreferences(state, userId) {
        let preference = state.preferences.accounts.find((p) => p.userId === userId);
        if (!preference) {
          preference = accountPreferences(state, userId);
          state.preferences.accounts.push(preference);
        }
        return preference;
      }
      async function reportsAccess(state, user) {
        if (user.role === 'admin' || !user.reportsPasscode) return true;
        const details = await sessionDetails(state);
        return Boolean(
          details && Date.parse(details.session.reportsUnlockedUntil) > now().valueOf(),
        );
      }
      async function requireReportsAccess(state, user) {
        if (!(await reportsAccess(state, user)))
          throw new DataError('Unlock My reports with your reports passcode.', 'reports_locked');
      }
      async function verifyOwnPassword(password) {
        const state = read();
        const user = await requireUser(state);
        if (blocked(state, user.id))
          throw new DataError(
            'Too many failed attempts. Wait 15 minutes and try again.',
            'credentials',
          );
        if (!(await verifyPassword(password, user.password))) {
          await mutate(async (currentState) => {
            const current = await requireUser(currentState);
            if (!blocked(currentState, current.id)) failedAttempt(currentState, current.id);
          });
          throw new DataError(
            'Your account password is incorrect.',
            'credentials',
            'currentPassword',
          );
        }
        return user;
      }
      function conversationRecord(state, conversationId, user, expectedVersion) {
        const record = state.conversations.find((c) => c.id === conversationId);
        if (!record || (user.role !== 'admin' && record.participantId !== user.id))
          throw new DataError('This conversation is unavailable.', 'not_found');
        if (expectedVersion !== undefined && expectedVersion !== record.version)
          throw new DataError(
            'This conversation changed. Refresh it before continuing.',
            'conflict',
          );
        return record;
      }
      function conversationView(state, record, user) {
        const participant = state.users.find((u) => u.id === record.participantId);
        const lastRead = record.readBy.find((r) => r.userId === user.id)?.messageId;
        const position = record.messages.findIndex((m) => m.id === lastRead);
        return {
          ...clone(record),
          participantName: participant?.name || 'University member',
          participantActive: participant?.status === 'active',
          unread: record.messages.slice(position + 1).filter((m) => m.authorId !== user.id).length,
        };
      }
      const service = {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        notifyExternalChange: emit,
        async initialize() {
          const operation = () => {
            const state = read();
            const raw = storage.getItem(STORAGE_KEY);
            if (raw === null || JSON.parse(raw).schemaVersion !== 3) write(state);
            return { hasAdmin: state.users.some((u) => u.role === 'admin') };
          };
          return locks?.request
            ? locks.request('cmualert.prototype.write', operation)
            : operation();
        },
        async getAccessState() {
          return { hasAdmin: read().users.some((u) => u.role === 'admin') };
        },
        async getSession() {
          const signedIn = await sessionDetails(read());
          return signedIn
            ? { ...safeUser(signedIn.user), sessionExpiresAt: signedIn.session.expiresAt }
            : null;
        },
        async registerStudent(input) {
          return createAccount(input, 'student');
        },
        async registerFaculty(input) {
          return createAccount(input, 'faculty');
        },
        async setupAdministrator(input) {
          return createAccount(input, 'admin');
        },
        async signIn(username, password) {
          const failure = () =>
            new DataError(
              'Sign-in was not successful. Check your username and password. After five failed attempts, wait 15 minutes before trying again.',
              'credentials',
            );
          const state = read();
          const user = state.users.find(
            (u) => u.username.toLowerCase() === String(username).trim().toLowerCase(),
          );
          const userId = user?.id || null;
          if (blocked(state, userId)) throw failure();
          // Unknown usernames also perform a password derivation; never store the supplied password.
          const verifier =
            user?.password ||
            (await (dummyVerifier ??= createPasswordVerifier(crypto.randomUUID())));
          const matches = await verifyPassword(password, verifier);
          const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join('');
          const tokenHash = await tokenDigest(token);
          const result = await mutate((current) => {
            const latest = current.users.find((u) => u.id === userId);
            if (blocked(current, userId)) return null;
            if (
              !matches ||
              !latest ||
              latest.status !== 'active' ||
              latest.password.hash !== user?.password.hash ||
              latest.authVersion !== user?.authVersion
            ) {
              failedAttempt(current, userId);
              audit(current, 'auth.sign_in_failed', null, latest);
              return null;
            }
            current.loginAttempts = current.loginAttempts.filter((a) => a.userId !== userId);
            current.sessions = current.sessions.filter(
              (s) => Date.parse(s.expiresAt) > now().valueOf(),
            );
            current.sessions.push({
              tokenHash,
              userId: latest.id,
              authVersion: latest.authVersion,
              expiresAt: new Date(now().valueOf() + SESSION_DURATION).toISOString(),
            });
            audit(current, 'auth.signed_in', latest, latest);
            return safeUser(latest);
          });
          if (!result) throw failure();
          setSession(token);
          emit();
          return result;
        },
        async signOut() {
          try {
            await mutate(async (state) => {
              const user = await sessionUser(state);
              const token = sessionToken();
              if (user) {
                const digest = await tokenDigest(token);
                state.sessions = state.sessions.filter((s) => s.tokenHash !== digest);
                audit(state, 'auth.signed_out', user, user);
              }
            });
          } finally {
            setSession(null);
            emit();
          }
        },
        async getPreferences() {
          const state = read();
          const user = await requireUser(state, undefined, true);
          return {
            reporterId: user.id,
            displayName: user.name,
            username: user.username,
            contact: clone(user.contact || { email: '', phone: '' }),
            avatar: user.avatar || '',
            hasReportsPasscode: Boolean(user.reportsPasscode),
            appearance: clone(state.preferences.appearance),
            allowNotifications: accountPreferences(state, user.id).allowNotifications,
            onboardingDismissed: accountPreferences(state, user.id).onboardingDismissed === true,
          };
        },
        async dismissOnboarding() {
          return mutate(async (state) => {
            const user = await requireUser(state);
            saveAccountPreferences(state, user.id).onboardingDismissed = true;
          });
        },
        async saveProfile(displayName, contact) {
          return mutate(async (state) => {
            const user = await requireUser(state);
            const name = required(displayName, 'Full name', 80);
            const changes = [];
            if (user.name !== name) changes.push({ field: 'name', from: user.name, to: name });
            if (contact !== undefined) {
              const email = optional(contact.email, 'Contact email', 120);
              const phone = optional(contact.phone, 'Contact number', 30);
              if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                throw new DataError('Enter a valid contact email.', 'validation', 'email');
              if (phone && !/^\+?[0-9 ()-]{7,30}$/.test(phone))
                throw new DataError('Enter a valid contact number.', 'validation', 'phone');
              for (const [field, value] of Object.entries({ email, phone })) {
                const previous = user.contact?.[field] || '';
                if (previous !== value) changes.push({ field, from: previous, to: value });
              }
              user.contact = { email, phone };
            }
            if (changes.length) {
              user.name = name;
              user.updatedAt = timestamp();
              user.version++;
              audit(state, 'account.profile_updated', user, user, { changes });
            }
            return {
              reporterId: user.id,
              displayName: user.name,
              username: user.username,
              contact: clone(user.contact || { email: '', phone: '' }),
            };
          });
        },
        async saveAvatar(avatar) {
          if (avatar !== '' && !validAvatar(avatar))
            throw new DataError('Choose a valid profile photo.');
          return mutate(async (state) => {
            const user = await requireUser(state);
            user.avatar = avatar;
            user.version++;
            user.updatedAt = timestamp();
            audit(state, 'account.profile_updated', user, user, {
              reason: 'Profile photo changed',
            });
          });
        },
        async getAppearance() {
          return clone(read().preferences.appearance);
        },
        async saveAppearance(input) {
          if (
            !['light', 'dark'].includes(input.theme) ||
            !['small', 'medium', 'large'].includes(input.fontSize)
          )
            throw new DataError('Choose a valid appearance setting.');
          return mutate(async (state) => {
            await requireUser(state);
            state.preferences.appearance = { theme: input.theme, fontSize: input.fontSize };
            return state.preferences.appearance;
          });
        },
        async saveNotifications(allow) {
          if (typeof allow !== 'boolean') throw new DataError('Choose a notification preference.');
          return mutate(async (state) => {
            const user = await requireUser(state);
            saveAccountPreferences(state, user.id).allowNotifications = allow;
          });
        },
        async getReportsAccess() {
          const state = read();
          const user = await requireUser(state);
          const session = (await sessionDetails(state))?.session;
          return {
            enabled: Boolean(user.reportsPasscode),
            unlocked: await reportsAccess(state, user),
            unlockedUntil: user.reportsPasscode ? session?.reportsUnlockedUntil || null : null,
          };
        },
        async setReportsPasscode({ currentPassword, passcode, confirmPasscode, remove = false }) {
          const verified = await verifyOwnPassword(currentPassword);
          if (!ACCOUNT_ROLES.includes(verified.role))
            throw new DataError('Only reporting accounts use this passcode.', 'forbidden');
          if (!remove && (!/^\d{6}$/.test(passcode) || passcode !== confirmPasscode))
            throw new DataError(
              'Enter and confirm the same six-digit passcode.',
              'validation',
              'confirmPasscode',
            );
          // Domain separation keeps this verifier distinct from the account password.
          const verifier = remove ? null : await createPasswordVerifier('reports:' + passcode);
          return mutate(async (state) => {
            const user = await requireReporter(state);
            if (
              user.id !== verified.id ||
              user.version !== verified.version ||
              blocked(state, user.id)
            )
              throw new DataError('Your account changed. Try again.', 'conflict');
            user.reportsPasscode = verifier;
            user.passcodeAttempt = { count: 0, blockedUntil: null };
            user.version++;
            user.updatedAt = timestamp();
            for (const session of state.sessions.filter((s) => s.userId === user.id))
              delete session.reportsUnlockedUntil;
            state.loginAttempts = state.loginAttempts.filter((a) => a.userId !== user.id);
            audit(state, 'account.reports_passcode_changed', user, user, {
              reason: remove
                ? 'Reports passcode removed by account holder'
                : 'Reports passcode set by account holder',
            });
          });
        },
        async unlockReports(passcode) {
          const result = await mutate(async (state) => {
            const user = await requireReporter(state);
            if (!user.reportsPasscode) return true;
            const attempt = user.passcodeAttempt || { count: 0, blockedUntil: null };
            if (Date.parse(attempt.blockedUntil) > now().valueOf()) return false;
            if (attempt.blockedUntil) {
              attempt.count = 0;
              attempt.blockedUntil = null;
            }
            if (
              !/^\d{6}$/.test(passcode) ||
              !(await verifyPassword('reports:' + passcode, user.reportsPasscode))
            ) {
              attempt.count = Math.min(5, attempt.count + 1);
              if (attempt.count >= 5)
                attempt.blockedUntil = new Date(now().valueOf() + ATTEMPT_WINDOW).toISOString();
              user.passcodeAttempt = attempt;
              return false;
            }
            user.passcodeAttempt = { count: 0, blockedUntil: null };
            const { session } = await sessionDetails(state);
            session.reportsUnlockedUntil = new Date(
              Math.min(Date.parse(session.expiresAt), now().valueOf() + 15 * 60 * 1000),
            ).toISOString();
            return true;
          });
          if (!result)
            throw new DataError(
              'Incorrect passcode or too many attempts. After five attempts, wait 15 minutes. You can reset it in Profile using your account password.',
              'credentials',
              'passcode',
            );
        },
        async lockReports() {
          return mutate(async (state) => {
            await requireReporter(state);
            const { session } = await sessionDetails(state);
            delete session.reportsUnlockedUntil;
          });
        },
        async listConversations() {
          const state = read();
          const user = await requireUser(state);
          return state.conversations
            .filter((c) => user.role === 'admin' || c.participantId === user.id)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((c) => conversationView(state, c, user));
        },
        async getConversation(conversationId) {
          const state = read();
          const user = await requireUser(state);
          return conversationView(state, conversationRecord(state, conversationId, user), user);
        },
        async createConversation({ participantId, subject, message }) {
          return mutate(async (state) => {
            const user = await requireUser(state, 'admin');
            const participant = state.users.find(
              (u) =>
                u.id === participantId && ACCOUNT_ROLES.includes(u.role) && u.status === 'active',
            );
            if (!participant)
              throw new DataError('Select an active student or faculty / staff account.');
            const createdAt = timestamp();
            const first = {
              id: id(),
              authorId: user.id,
              authorRole: user.role,
              text: required(message, 'Message'),
              createdAt,
            };
            const record = {
              id: id(),
              participantId,
              subject: required(subject, 'Subject', 160),
              createdAt,
              updatedAt: createdAt,
              version: 1,
              replyStatus: 'none',
              messages: [first],
              readBy: [{ userId: user.id, messageId: first.id }],
            };
            state.conversations.push(record);
            return conversationView(state, record, user);
          });
        },
        async sendMessage(conversationId, { message, expectedVersion }) {
          return mutate(async (state) => {
            const user = await requireUser(state);
            const record = conversationRecord(state, conversationId, user, expectedVersion);
            if (user.role !== 'admin' && record.replyStatus !== 'approved')
              throw new DataError('Your administrator must approve replies first.', 'forbidden');
            if (!state.users.some((u) => u.id === record.participantId && u.status === 'active'))
              throw new DataError('This account is disabled. Messaging is paused.', 'forbidden');
            const createdAt = timestamp();
            const entry = {
              id: id(),
              authorId: user.id,
              authorRole: user.role,
              text: required(message, 'Message'),
              createdAt,
            };
            record.messages.push(entry);
            record.updatedAt = createdAt;
            record.version++;
            record.readBy = record.readBy.filter((r) => r.userId !== user.id);
            record.readBy.push({ userId: user.id, messageId: entry.id });
            return conversationView(state, record, user);
          });
        },
        async setReplyPermission(conversationId, { decision, expectedVersion }) {
          return mutate(async (state) => {
            const user = await requireUser(state);
            const record = conversationRecord(state, conversationId, user, expectedVersion);
            if (user.role === 'admin') {
              if (!['approved', 'denied'].includes(decision))
                throw new DataError('Choose a reply decision.');
            } else if (decision !== 'pending' || !['none', 'denied'].includes(record.replyStatus))
              throw new DataError('This reply request cannot be changed.', 'forbidden');
            record.replyStatus = decision;
            record.updatedAt = timestamp();
            record.version++;
            return conversationView(state, record, user);
          });
        },
        async markConversationRead(conversationId) {
          const state = read();
          const user = await requireUser(state);
          const record = conversationRecord(state, conversationId, user);
          if (
            record.readBy.some(
              (r) => r.userId === user.id && r.messageId === record.messages.at(-1).id,
            )
          )
            return;
          return mutate(async (state) => {
            const user = await requireUser(state);
            const record = conversationRecord(state, conversationId, user);
            record.readBy = record.readBy.filter((r) => r.userId !== user.id);
            record.readBy.push({ userId: user.id, messageId: record.messages.at(-1).id });
          });
        },
        async listActivity() {
          const state = read();
          const user = await requireUser(state);
          const preference = accountPreferences(state, user.id);
          const activity = [];
          for (const a of await service.listAnnouncements({ role: user.role, publishedOnly: true }))
            activity.push({
              id: `announcement:${a.id}:${a.version}`,
              title: a.title,
              detail: a.category,
              createdAt: a.updatedAt,
              href: '#announcements',
              announcementId: a.id,
            });
          for (const r of state.reports) {
            if (
              user.role === 'admin' ||
              (r.mode === 'identified' && r.reporterId === user.id && r.reporterUpdates.length)
            )
              activity.push({
                id: `report:${r.id}:${user.role === 'admin' ? 1 : r.version}`,
                title:
                  user.role === 'admin' ? 'Incident report received' : 'Your report has an update',
                detail: `${r.reference} · ${r.status}`,
                createdAt: user.role === 'admin' ? r.createdAt : r.updatedAt,
                href: `#reports/${r.id}`,
              });
          }
          for (const c of state.conversations.filter(
            (c) => user.role === 'admin' || c.participantId === user.id,
          )) {
            for (const m of c.messages.filter((m) => m.authorId !== user.id))
              activity.push({
                id: `message:${c.id}:${m.id}`,
                title: 'New inbox message',
                detail: c.subject,
                createdAt: m.createdAt,
                href: `#inbox/${c.id}`,
              });
            if (user.role === 'admin' && c.replyStatus === 'pending')
              activity.push({
                id: `reply:${c.id}:${c.version}`,
                title: 'Reply approval requested',
                detail: c.subject,
                createdAt: c.updatedAt,
                href: `#inbox/${c.id}`,
              });
            if (user.role !== 'admin' && ['approved', 'denied'].includes(c.replyStatus))
              activity.push({
                id: `permission:${c.id}:${c.replyStatus}`,
                title:
                  c.replyStatus === 'approved' ? 'Replies are enabled' : 'Reply request declined',
                detail: c.subject,
                createdAt: c.updatedAt,
                href: `#inbox/${c.id}`,
              });
          }
          return activity
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 200)
            .map((a) => ({ ...a, read: preference.readActivity.includes(a.id) }));
        },
        async markActivityRead(ids) {
          const visible = new Set((await service.listActivity()).map((a) => a.id));
          const selected = Array.isArray(ids) ? ids.filter((value) => visible.has(value)) : [];
          if (!selected.length) return;
          const state = read();
          const user = await requireUser(state);
          if (
            selected.every((value) =>
              accountPreferences(state, user.id).readActivity.includes(value),
            )
          )
            return;
          return mutate(async (state) => {
            const user = await requireUser(state);
            const preference = saveAccountPreferences(state, user.id);
            preference.readActivity = [...new Set([...preference.readActivity, ...selected])].slice(
              -1000,
            );
          });
        },
        async changePassword(currentPassword, password, confirmPassword) {
          const user = await requireUser(read(), undefined, true);
          if (!(await verifyPassword(currentPassword, user.password)))
            throw new DataError('Your current password is incorrect.');
          if (password !== confirmPassword) throw new DataError('Passwords do not match.');
          passwordPolicy(password, user.role);
          if (await verifyPassword(password, user.password))
            throw new DataError('Choose a new password that differs from your current password.');
          const verifier = await createPasswordVerifier(password);
          const result = await mutate(async (state) => {
            const current = await requireUser(state, undefined, true);
            if (current.version !== user.version)
              throw new DataError(
                'Your profile changed. Refresh before changing the password.',
                'conflict',
              );
            current.password = verifier;
            current.mustChangePassword = false;
            current.version++;
            current.updatedAt = timestamp();
            revokeSessions(state, current);
            state.loginAttempts = state.loginAttempts.filter((a) => a.userId !== current.id);
            audit(state, 'account.password_changed', current, current);
            return safeUser(current);
          });
          setSession(null);
          emit();
          return result;
        },
        async listAccounts({ query = '', role = '', status = '' } = {}) {
          const state = read();
          await requireUser(state, 'admin');
          return state.users
            .filter(
              (u) =>
                (!role || u.role === role) &&
                (!status || u.status === status) &&
                `${u.name} ${u.username}`.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(safeUser);
        },
        async getAccount(accountId) {
          const state = read();
          await requireUser(state, 'admin');
          const user = state.users.find((u) => u.id === accountId);
          if (!user) throw new DataError('This account could not be found.', 'not_found');
          return safeUser(user);
        },
        async createManagedAccount(input) {
          const actor = await verifyAdministrator(input.currentPassword);
          if (!ACCOUNT_ROLES.includes(input.role))
            throw new DataError(
              'Choose Student or Faculty / staff. Administrator accounts cannot be created here.',
              'forbidden',
            );
          const details = accountDetails(input);
          if (input.password !== input.confirmPassword)
            throw new DataError('Passwords do not match.');
          const password = await createPasswordVerifier(input.password);
          return mutate(async (state) => {
            const administrator = await confirmedAdministrator(state, actor);
            if (state.users.some((u) => u.username.toLowerCase() === details.username))
              throw new DataError('This username is already registered.', 'conflict');
            const user = {
              id: id(),
              ...details,
              role: input.role,
              password,
              status: 'active',
              authVersion: 1,
              mustChangePassword: true,
              createdAt: timestamp(),
              updatedAt: timestamp(),
              version: 1,
            };
            state.users.push(user);
            audit(state, 'account.created', administrator, user);
            return safeUser(user);
          });
        },
        async updateAccount(accountId, input) {
          const actor = await verifyAdministrator(input.currentPassword);
          if (!ACCOUNT_ROLES.includes(input.role) || !['active', 'disabled'].includes(input.status))
            throw new DataError(
              'Choose a valid student or staff role and account status.',
              'forbidden',
            );
          const details = accountDetails(input);
          const reason = required(input.reason, 'Reason for change', 500);
          return mutate(async (state) => {
            const administrator = await confirmedAdministrator(state, actor);
            const user = managedAccount(state, accountId, input.expectedVersion);
            if (
              state.users.some(
                (u) => u.id !== user.id && u.username.toLowerCase() === details.username,
              )
            )
              throw new DataError('This username is already registered.', 'conflict');
            const next = { ...details, role: input.role, status: input.status };
            const changes = Object.keys(next)
              .filter((field) => user[field] !== next[field])
              .map((field) => ({ field, from: user[field], to: next[field] }));
            if (!changes.length)
              throw new DataError('Change an account detail, role, or status before saving.');
            Object.assign(user, next, { updatedAt: timestamp(), version: user.version + 1 });
            if (changes.some((c) => ['username', 'role', 'status'].includes(c.field)))
              revokeSessions(state, user);
            for (const [action, fields] of [
              ['account.updated', ['name', 'username']],
              ['account.role_changed', ['role']],
              ['account.status_changed', ['status']],
            ]) {
              const affected = changes.filter((c) => fields.includes(c.field));
              if (affected.length)
                audit(state, action, administrator, user, { reason, changes: affected });
            }
            return safeUser(user);
          });
        },
        async resetAccountPassword(accountId, input) {
          const actor = await verifyAdministrator(input.currentPassword);
          const reason = required(input.reason, 'Reason for password reset', 500);
          if (input.password !== input.confirmPassword)
            throw new DataError('Passwords do not match.');
          const password = await createPasswordVerifier(input.password);
          return mutate(async (state) => {
            const administrator = await confirmedAdministrator(state, actor);
            const user = managedAccount(state, accountId, input.expectedVersion);
            user.password = password;
            user.mustChangePassword = true;
            user.version++;
            user.updatedAt = timestamp();
            revokeSessions(state, user);
            state.loginAttempts = state.loginAttempts.filter((a) => a.userId !== user.id);
            audit(state, 'account.password_reset', administrator, user, { reason });
            return safeUser(user);
          });
        },
        async listAuditLog({ query = '', action = '', scope = '' } = {}) {
          const state = read();
          await requireUser(state, 'admin');
          if (!['', 'accounts', 'incidents', 'announcements'].includes(scope))
            throw new DataError('Choose a valid activity group.');
          return clone(
            state.auditLog
              .filter(
                (e) =>
                  (!action || e.action === action) &&
                  (!scope ||
                    (scope === 'accounts' && /^(admin|account|auth)\./.test(e.action)) ||
                    (scope === 'incidents' && e.action.startsWith('incident.')) ||
                    (scope === 'announcements' && e.action.startsWith('announcement.'))) &&
                  `${AUDIT_ACTIONS[e.action]} ${e.actor?.name || ''} ${e.actor?.username || ''} ${e.target?.name || ''} ${e.target?.username || ''} ${e.resource?.label || ''} ${e.reason}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
              )
              .reverse(),
          );
        },
        validateReport,
        async createReport(input, { files = [], submissionId } = {}) {
          const reporter = await requireReporter(read());
          const details = validateReport(input);
          validateFiles(files);
          required(submissionId, 'Submission identifier', 100);
          const existing = read().reports.find((r) => r.submissionId === submissionId);
          if (existing) {
            if (existing.mode === 'identified' && existing.reporterId !== reporter.id)
              throw new DataError('That submission identifier is already in use.', 'conflict');
            return clone(existing);
          }
          const recordId = id();
          const entries = files.map((file) => ({ id: `${recordId}/${id()}`, file }));
          if (entries.length && !attachments)
            throw new DataError('Attachment storage is unavailable. Remove the files to continue.');
          if (entries.length) await attachments.putMany(entries);
          try {
            const saved = await mutate(async (state) => {
              const currentReporter = await requireReporter(state);
              if (currentReporter.id !== reporter.id || currentReporter.role !== reporter.role)
                throw new DataError(
                  'Your account changed. Sign in again before submitting.',
                  'conflict',
                );
              const duplicate = state.reports.find((r) => r.submissionId === submissionId);
              if (duplicate) return duplicate;
              const createdAt = timestamp();
              let reference;
              do {
                reference = `CMU-${now().getFullYear()}-${id().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
              } while (state.reports.some((r) => r.reference === reference));
              let trackingReference = null;
              if (details.mode === 'anonymous')
                do {
                  trackingReference = `TRK-${id().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
                } while (state.reports.some((r) => r.trackingReference === trackingReference));
              const report = {
                ...details,
                id: recordId,
                reference,
                trackingReference,
                submissionId,
                reporterId: details.mode === 'identified' ? reporter.id : null,
                reporterName: details.mode === 'identified' ? reporter.name : null,
                reporterRole: details.mode === 'identified' ? reporter.role : null,
                status: 'Submitted',
                createdAt,
                updatedAt: createdAt,
                version: 1,
                attachments: entries.map(({ id: attachmentId, file }) => ({
                  id: attachmentId,
                  name: file.name,
                  type: file.type,
                  size: file.size,
                })),
                history: [
                  {
                    id: id(),
                    status: 'Submitted',
                    createdAt,
                    actor: details.mode === 'anonymous' ? 'Anonymous reporter' : reporter.name,
                    actorId: details.mode === 'anonymous' ? null : reporter.id,
                    message: 'Report submitted.',
                  },
                ],
                internalNotes: [],
                reporterUpdates: [],
                actions: [],
                resolution: null,
              };
              state.reports.push(report);
              return report;
            });
            if (saved.id !== recordId && entries.length)
              await attachments.removeMany(entries.map((e) => e.id)).catch(() => {});
            return saved;
          } catch (error) {
            if (entries.length)
              await attachments.removeMany(entries.map((e) => e.id)).catch(() => {});
            throw error;
          }
        },
        async listReports({
          role = 'student',
          query = '',
          category = '',
          status = '',
          sort = 'submitted',
          fromDate = '',
          toDate = '',
        } = {}) {
          const state = read();
          const user = await requireUser(state, role === 'admin' ? 'admin' : undefined);
          if (role !== 'admin') await requireReportsAccess(state, user);
          const validDate = (value) => {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
            const parsed = new Date(`${value}T00:00:00Z`);
            return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
          };
          if (fromDate && !validDate(fromDate))
            throw new DataError('Enter a valid start date.', 'validation', 'fromDate');
          if (toDate && !validDate(toDate))
            throw new DataError('Enter a valid end date.', 'validation', 'toDate');
          if (fromDate && toDate && fromDate > toDate)
            throw new DataError('End date must be on or after start date.', 'validation', 'toDate');
          if (
            ![
              'submitted',
              'oldest',
              'updated',
              ...(role === 'admin' ? ['attention'] : []),
            ].includes(sort)
          )
            throw new DataError('Choose a valid report order.', 'validation', 'sort');
          const submittedDate = (value) => {
            const parsed = new Date(value);
            return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
          };
          const filtered = state.reports
            .filter(
              (r) => role === 'admin' || (r.mode === 'identified' && r.reporterId === user.id),
            )
            .filter(
              (r) =>
                (!category || r.category === category) &&
                (!status || r.status === status) &&
                (!fromDate || submittedDate(r.createdAt) >= fromDate) &&
                (!toDate || submittedDate(r.createdAt) <= toDate) &&
                `${r.reference} ${r.title} ${r.location}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
            )
            .sort(
              (a, b) =>
                (sort === 'attention'
                  ? Number(b.category === 'weapon' && !['Resolved', 'Closed'].includes(b.status)) -
                      Number(
                        a.category === 'weapon' && !['Resolved', 'Closed'].includes(a.status),
                      ) ||
                    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
                    a.createdAt.localeCompare(b.createdAt) ||
                    a.id.localeCompare(b.id)
                  : 0) ||
                (sort === 'updated'
                  ? b.updatedAt.localeCompare(a.updatedAt)
                  : sort === 'oldest'
                    ? a.createdAt.localeCompare(b.createdAt)
                    : b.createdAt.localeCompare(a.createdAt)) ||
                (sort === 'oldest'
                  ? a.createdAt.localeCompare(b.createdAt)
                  : b.createdAt.localeCompare(a.createdAt)) ||
                (sort === 'oldest' ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id)),
            );
          return clone(role === 'admin' ? filtered : filtered.map((r) => publicReport(r)));
        },
        async getIncident(reportId, { role = 'student' } = {}) {
          const state = read();
          const user = await requireUser(state, role === 'admin' ? 'admin' : undefined);
          const report = getReport(state, reportId);
          if (role === 'admin') return clone(report);
          await requireReportsAccess(state, user);
          if (report.mode !== 'identified' || report.reporterId !== user.id)
            throw new DataError(
              'This report is not associated with your signed-in account.',
              'forbidden',
            );
          return publicReport(report);
        },
        async trackAnonymous(reference) {
          if (typeof reference !== 'string' || !reference.trim())
            throw new DataError('Enter your tracking reference.', 'validation', 'reference');
          const normalized = reference.trim().toUpperCase();
          const report = read().reports.find(
            (r) => r.mode === 'anonymous' && r.trackingReference === normalized,
          );
          // Look up existing references first so earlier receipts remain usable.
          if (!report && !/^TRK-[A-Z0-9]{6,32}$/.test(normalized))
            throw new DataError(
              'Enter the full TRK- tracking reference from your receipt.',
              'validation',
              'reference',
            );
          if (!report)
            throw new DataError(
              'No report matches this tracking reference. Check the full reference and try again.',
              'not_found',
              'reference',
            );
          return publicReport(report, true);
        },
        async updateIncident(reportId, input) {
          return mutate(async (state) => {
            const administrator = await requireUser(state, 'admin');
            const report = getReport(state, reportId);
            if (input.expectedVersion !== report.version)
              throw new DataError(
                'This report was updated in another tab. Reopen the report to review the latest details before saving.',
                'conflict',
              );
            if (!STATUSES.includes(input.status))
              throw new DataError('Select a valid report status.');
            const changed = report.status !== input.status;
            const previousStatus = report.status;
            if (changed && !TRANSITIONS[report.status].includes(input.status))
              throw new DataError(`A report cannot move from ${report.status} to ${input.status}.`);
            const publicUpdate = optional(input.publicUpdate, 'Reporter update');
            const internalNote = optional(input.internalNote, 'Internal note');
            const action = optional(input.action, 'Action taken');
            const resolution = optional(input.resolution, 'Resolution');
            if (changed && !publicUpdate)
              throw new DataError('Add a reporter-visible explanation for the status change.');
            if (changed && input.status === 'Resolved' && !resolution)
              throw new DataError('Document the resolution before marking the report as resolved.');
            if (resolution && input.status !== 'Resolved')
              throw new DataError('Resolution details can be saved when the status is Resolved.');
            if (!changed && !publicUpdate && !internalNote && !action && !resolution)
              throw new DataError(
                'Add an update, action, internal note, or resolution before saving.',
              );
            const createdAt = timestamp();
            const entry = (text) => ({
              id: id(),
              text,
              createdAt,
              actor: administrator.name,
              actorId: administrator.id,
            });
            if (changed)
              report.history.push({
                id: id(),
                status: input.status,
                createdAt,
                actor: administrator.name,
                actorId: administrator.id,
                message: publicUpdate,
              });
            if (publicUpdate) report.reporterUpdates.push(entry(publicUpdate));
            if (internalNote) report.internalNotes.push(entry(internalNote));
            if (action) report.actions.push(entry(action));
            if (resolution) report.resolution = entry(resolution);
            if (changed && report.status === 'Resolved' && input.status === 'In Progress')
              report.resolution = null;
            report.status = input.status;
            report.updatedAt = createdAt;
            report.version += 1;
            audit(state, 'incident.updated', administrator, null, {
              resource: { type: 'incident', id: report.id, label: report.reference },
              reason: [
                changed ? `Status: ${previousStatus} to ${input.status}.` : 'Status unchanged.',
                publicUpdate ? 'Reporter update added.' : '',
                internalNote ? 'Internal note added.' : '',
                action ? 'Action recorded.' : '',
                resolution ? 'Resolution documented.' : '',
              ]
                .filter(Boolean)
                .join(' '),
            });
            return report;
          });
        },
        async getAttachment(reportId, attachmentId, { role = 'student' } = {}) {
          const report = await service.getIncident(reportId, { role });
          if (!report.attachments.some((a) => a.id === attachmentId))
            throw new DataError('Attachment unavailable for this report.', 'forbidden');
          return attachments.get(attachmentId);
        },
        async listAnnouncements({
          role = 'student',
          publishedOnly = false,
          category = '',
          status = '',
          query = '',
        } = {}) {
          const state = read();
          if (role === 'admin') await requireUser(state, 'admin');
          const user = await sessionUser(state);
          const viewer = user?.mustChangePassword ? null : user;
          const management = role === 'admin' && !publishedOnly;
          const matchesAudience = (a) =>
            a.audience === 'University community' ||
            (a.audience === 'All students' && viewer?.role === 'student') ||
            (a.audience === 'Faculty and staff' && viewer?.role === 'faculty') ||
            (a.audience === 'Administrators' && viewer?.role === 'admin');
          const activeEmergency = (a) => Number(a.status === 'Published' && isEmergencyAdvisory(a));
          const records = state.announcements
            .filter((a) => management || (a.status === 'Published' && matchesAudience(a)))
            .filter(
              (a) =>
                (!category || a.category === category) &&
                (!status || a.status === status) &&
                `${a.title} ${a.content}`.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .sort(
              (a, b) =>
                activeEmergency(b) - activeEmergency(a) ||
                Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
                (b.publishedAt || b.updatedAt).localeCompare(a.publishedAt || a.updatedAt),
            );
          return clone(records);
        },
        async getAnnouncement(announcementId, { role = 'student' } = {}) {
          const records = await service.listAnnouncements({ role });
          const record = records.find((a) => a.id === announcementId);
          if (!record)
            throw new DataError('This announcement is no longer available.', 'not_found');
          return record;
        },
        async saveAnnouncement(input) {
          await requireUser(read(), 'admin');
          const title = required(input.title, 'Announcement title', 160);
          const content = required(input.content, 'Announcement content', 10000);
          if (
            !ANNOUNCEMENT_CATEGORIES.includes(input.category) ||
            !AUDIENCES.includes(input.audience)
          )
            throw new DataError('Choose a valid category and audience.');
          if (!['Draft', 'Published'].includes(input.status))
            throw new DataError('Save the announcement as Draft or Published.');
          return mutate(async (state) => {
            const administrator = await requireUser(state, 'admin');
            let announcement = input.id ? state.announcements.find((a) => a.id === input.id) : null;
            if (input.id && !announcement)
              throw new DataError('This announcement could not be found.');
            if (announcement && input.expectedVersion !== announcement.version)
              throw new DataError(
                'This announcement changed in another tab. Reopen it before saving.',
                'conflict',
              );
            const updatedAt = timestamp();
            const isNew = !announcement;
            const previousStatus = announcement?.status;
            if (!announcement) {
              announcement = { id: id(), createdAt: updatedAt, publishedAt: null, version: 0 };
              state.announcements.push(announcement);
            }
            if (input.status === 'Published' && announcement.status !== 'Published')
              announcement.publishedAt = updatedAt;
            Object.assign(announcement, {
              title,
              content,
              category: input.category,
              audience: input.audience,
              status: input.status,
              updatedAt,
              authorId: administrator.id,
              pinned: Boolean(input.pinned),
              version: announcement.version + 1,
            });
            audit(
              state,
              input.status === 'Published' && previousStatus !== 'Published'
                ? 'announcement.published'
                : isNew
                  ? 'announcement.created'
                  : 'announcement.updated',
              administrator,
              null,
              {
                resource: { type: 'announcement', id: announcement.id, label: title },
                reason: `${isNew ? 'Created' : 'Saved'} as ${input.status}. Audience: ${input.audience}. Category: ${input.category}.${input.pinned ? ' Pinned.' : ''}`,
              },
            );
            return announcement;
          });
        },
        async archiveAnnouncement(announcementId, expectedVersion) {
          return mutate(async (state) => {
            const administrator = await requireUser(state, 'admin');
            const record = state.announcements.find((a) => a.id === announcementId);
            if (!record) throw new DataError('This announcement could not be found.');
            if (record.version !== expectedVersion)
              throw new DataError(
                'This announcement changed. Refresh the page before archiving.',
                'conflict',
              );
            if (record.status === 'Archived')
              throw new DataError('This announcement is already archived.');
            record.status = 'Archived';
            record.updatedAt = timestamp();
            record.version++;
            audit(state, 'announcement.archived', administrator, null, {
              resource: { type: 'announcement', id: record.id, label: record.title },
              reason: 'Archived; removed from the published feed.',
            });
            return record;
          });
        },
        async getSummary({ role = 'student' } = {}) {
          const state = read();
          const user = await requireUser(state, role === 'admin' ? 'admin' : undefined);
          const reports = state.reports.filter(
            (r) => role === 'admin' || (r.mode === 'identified' && r.reporterId === user.id),
          );
          const announcements = await service.listAnnouncements({ role });
          return {
            total: reports.length,
            open: reports.filter((r) => !['Resolved', 'Closed'].includes(r.status)).length,
            resolved: reports.filter((r) => ['Resolved', 'Closed'].includes(r.status)).length,
            announcements: announcements.filter((a) => a.status === 'Published').length,
            statuses: Object.fromEntries(
              STATUSES.map((status) => [status, reports.filter((r) => r.status === status).length]),
            ),
            categories: Object.fromEntries(
              ALL_CATEGORIES.map((c) => [c.id, reports.filter((r) => r.category === c.id).length]),
            ),
          };
        },
        async exportStoredData({ damagedOnly = false } = {}) {
          if (damagedOnly) {
            try {
              read();
              throw new DataError(
                'Use administrator settings to export valid account data.',
                'forbidden',
              );
            } catch (error) {
              if (!['corrupt', 'schema'].includes(error.code)) throw error;
            }
          } else await requireUser(read(), 'admin');
          return storage.getItem(STORAGE_KEY) || '';
        },
        async reset({ damagedOnly = false, currentPassword } = {}) {
          // Verify before taking the write lock: failed verification records an audit event.
          const administrator = damagedOnly ? null : await verifyAdministrator(currentPassword);
          const operation = async () => {
            if (damagedOnly) {
              try {
                read();
                throw new DataError(
                  'Valid browser data can be reset by an administrator in Settings.',
                  'forbidden',
                );
              } catch (error) {
                if (!['corrupt', 'schema'].includes(error.code)) throw error;
              }
            } else await confirmedAdministrator(read(), administrator);
            try {
              storage.removeItem(STORAGE_KEY);
            } catch {
              throw new DataError(
                'Could not reset CMUAlert data. Browser storage is unavailable.',
                'storage',
              );
            }
            setSession(null);
            initial = undefined;
            let cleanupError;
            try {
              await attachments?.clear();
            } catch (error) {
              cleanupError = error;
            }
            emit();
            if (cleanupError)
              throw new DataError(
                'Records were reset, but attachment cleanup failed. Retry Reset local data to remove remaining files.',
                'storage',
              );
          };
          const next = queue.then(() =>
            locks?.request ? locks.request('cmualert.prototype.write', operation) : operation(),
          );
          queue = next.catch(() => {});
          return next;
        },
      };
      return service;
    }

    return { STORAGE_KEY, SESSION_KEY, ACCOUNT_ROLES, AUDIT_ACTIONS, DataError, createDataService };
  })();
  // Interface icons and campus artwork
  // 5. Reusable SVG icons and campus artwork
  __modules['icons'] = await (async function () {
    const paths = {
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
      inbox: '<path d="m3 4-2 12v5h22v-5L21 4zM1 16h6l2 3h6l2-3h6"/>',
      moon: '<path d="M21 13a9 9 0 0 1-10-10A9 9 0 1 0 21 13Z"/>',
      camera: '<path d="m8 5 2-2h4l2 2h5v16H3V5z"/><circle cx="12" cy="13" r="4"/>',
      logout: '<path d="M9 3H4v18h5m5-14 5 5-5 5M9 12h12"/>',
      shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="m8 12 3 3 5-6"/>',
      'shield-alert': '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6z"/><path d="M12 8v5m0 3h.01"/>',
      dashboard:
        '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      report:
        '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      megaphone: '<path d="m3 9 17-5v16L3 15zM3 9v6m5 2 2 5h4l-2-4M20 8l2-1m-2 9 2 1"/>',
      settings:
        '<path d="m9 3-.5 3-2 .9-2.6-1-2 3.4L4 12l-2.1 2.7 2 3.4 2.6-1 2 .9.5 3h4l.5-3 2-.9 2.6 1 2-3.4L18 12l2.1-2.7-2-3.4-2.6 1-2-.9-.5-3z"/><circle cx="11" cy="12" r="3"/>',
      users:
        '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
      building:
        '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5M9 9h.01M15 9h.01M9 12h.01M15 12h.01"/>',
      arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
      chevron: '<path d="m9 5 7 7-7 7"/>',
      down: '<path d="m6 9 6 6 6-6"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.9 2c-1.1.7-1.4 1.1-1.4 2M12 17h.01"/>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
      eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
      alert: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
      pin: '<path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 0 1 14 0z"/><circle cx="12" cy="10" r="2"/>',
      calendar:
        '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h.01m4 0h.01m4 0h.01"/>',
      paperclip: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m-7 13 9-9"/>',
      upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
      close: '<path d="m6 6 12 12M6 18 18 6"/>',
      menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
      back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
      copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
      edit: '<path d="m16 3 5 5-12 12-6 1 1-6zM13 6l5 5"/>',
      archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8m-10 4h6"/>',
      chart: '<path d="M3 3v18h18M8 17v-5m5 5V7m5 10V9"/>',
      download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>',
      mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
      spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
    };
    const icon = (name, cls = '') =>
      `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.report}</svg>`;

    const campusArt = [
      `<svg class="campus-art" viewBox="0 0 340 230" fill="none" aria-hidden="true">`,
      `<circle cx="190" cy="116" r="96" fill="#DFE9F7"/>`,
      `<circle cx="190" cy="116" r="78" stroke="#CFDDF0" stroke-dasharray="4 7"/>`,
      `<path d="M67 181h230" stroke="#B2C6E2" stroke-width="2" stroke-linecap="round"/>`,
      `<path d="M111 165V97l77-37 76 37v68" fill="#fff" stroke="#A8BFDF" stroke-width="2"/>`,
      `<path d="m104 98 84-44 83 44H104Z" fill="#C9D9EF"/>`,
      `<path d="m133 91 55-28 54 28H133Z" fill="#EDF3FB"/>`,
      `<rect x="129" y="106" width="16" height="55" rx="2" fill="#E0E9F6"/>`,
      `<rect x="160" y="106" width="16" height="55" rx="2" fill="#E0E9F6"/>`,
      `<rect x="201" y="106" width="16" height="55" rx="2" fill="#E0E9F6"/>`,
      `<rect x="231" y="106" width="16" height="55" rx="2" fill="#E0E9F6"/>`,
      `<rect x="108" y="161" width="159" height="9" rx="2" fill="#B9CDEA"/>`,
      `<rect x="101" y="171" width="173" height="9" rx="2" fill="#CFDDF0"/>`,
      `<path d="M189 27v26m0-25h29l-7 8 7 8h-29" stroke="#8EAAD1" stroke-width="2" stroke-linejoin="round"/>`,
      `<path d="M249 104 284 117v27c0 27-35 45-35 45s-35-18-35-45v-27l35-13Z" fill="#0B2D6B" stroke="#EFF5FE" stroke-width="5"/>`,
      `<path d="m233 144 10 10 23-25" stroke="#F4BD37" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<circle cx="86" cy="92" r="17" fill="#fff"/>`,
      `<path d="m80 92 4 4 8-8" stroke="#4C86B9" stroke-width="2" stroke-linecap="round"/>`,
      `<circle cx="285" cy="66" r="5" fill="#F3C651"/>`,
      `<circle cx="88" cy="148" r="4" fill="#B3C9E7"/>`,
      `<path d="m301 100 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" fill="#E9BC4E"/>`,
      `<path d="M66 177v-29m-8 14 8 7 8-12" stroke="#81AD9F" stroke-width="3" stroke-linecap="round"/>`,
      `<path d="M312 178v-21m-6 7 6 6 7-10" stroke="#81AD9F" stroke-width="3" stroke-linecap="round"/>`,
      `</svg>`,
    ].join('');

    return { icon, campusArt };
  })();
  // 6. Welcome, registration, and sign-in pages
  __modules['access'] = await (async function () {
    const { icon } = __modules['icons'];

    const esc = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
    // CMU logo, displayed unchanged: https://cityofmalabonuniversity.edu.ph/wp-content/uploads/2021/04/cmu-logo.png
    const logo =
      '<img src="assets/cmu-logo.png" alt="City of Malabon University logo" width="400" height="416">';
    const brand = [
      `<span class="access-brand-mark">${logo}</span>`,
      `<span class="brand-text">CMU<span>Alert</span>`,
      `<small>City of Malabon University</small>`,
      `</span>`,
    ].join('');
    const emblem = [
      `<div class="access-emblem">`,
      `<span class="emblem-orbit orbit-outer">`,
      `</span>`,
      `<span class="emblem-orbit orbit-inner">`,
      `</span>`,
      `<span class="emblem-crest">${logo}</span>`,
      `<span class="emblem-spark" aria-hidden="true">`,
      `</span>`,
      `</div>`,
    ].join('');

    function welcomePage({ hasAdmin = false, signedIn = false } = {}) {
      return [
        `<div class="welcome-page">`,
        `
    <header class="welcome-header">`,
        `<a class="public-brand" href="#welcome" aria-label="CMUAlert home">${brand}</a>`,
        `<nav aria-label="Welcome navigation">`,
        `<a href="#announcements" class="welcome-announcements-link">Campus announcements</a>`,
        `<a class="welcome-sign-in" href="${signedIn ? '#dashboard' : '#login'}">${signedIn ? 'Open portal' : 'Sign in'} ${icon('arrow')}</a>`,
        `</nav>`,
        `</header>`,
        `
    <main id="main" class="welcome-main" tabindex="-1">`,
        `<div id="advisory-banner" aria-live="polite">`,
        `</div>`,
        `<div class="welcome-stage" id="view">
      ${emblem}<p class="welcome-eyebrow">CITY OF MALABON UNIVERSITY</p>`,
        `<h1>Safer campus.<br>`,
        `<span>Stronger community.</span>`,
        `</h1>`,
        `<p class="welcome-description">Campus incident reporting and announcements.</p>`,
        `
      <div class="welcome-actions">`,
        `<a class="btn btn-primary welcome-primary" href="${signedIn ? '#dashboard' : '#signup'}">${signedIn ? 'Go to your dashboard' : 'Get started'} ${icon('arrow')}</a>${signedIn ? '' : '<p>Already have an account? <a href="#login">Sign in</a></p>'}</div>`,
        `
      <nav class="welcome-quick-links" aria-label="Public services">`,
        `<a href="#track">${icon('search')} Track a report</a>`,
        `<span aria-hidden="true">`,
        `</span>`,
        `<a href="#announcements">${icon('megaphone')} Announcements</a>`,
        `</nav>`,
        `
    </div>`,
        `</main>`,
        `
    <footer class="welcome-footer">`,
        `<span>© ${new Date().getFullYear()} CMUAlert</span>${!signedIn && !hasAdmin ? '<a href="#setup">Set up the first administrator ' + icon('arrow') + '</a>' : '<span>City of Malabon University</span>'}</footer>`,
        `
  </div>`,
      ].join('');
    }

    function passwordField(id, label, name, creating = false, minimum = 8) {
      return [
        `<div class="field">`,
        `<label for="${id}">${label}</label>`,
        `<div class="password-input">`,
        `<span class="access-input-icon">${icon('lock')}</span>`,
        `<input id="${id}" name="${name}" type="password" ${creating ? `minlength="${minimum}" maxlength="128" autocomplete="new-password"` : 'maxlength="128" autocomplete="current-password"'} required placeholder="${name === 'confirmPassword' ? 'Enter your password again' : creating ? 'Create a password' : 'Enter your password'}">`,
        `<button type="button" class="icon-button" data-action="toggle-password" data-target="${id}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">${icon('eye')}</button>`,
        `</div>`,
        `</div>`,
      ].join('');
    }

    function accessPage({ page = 'login', hasAdmin = false, error = '', username = '' } = {}) {
      const setup = page === 'setup',
        signup = page === 'signup',
        creating = setup || signup;
      return [
        `<div class="access-layout">`,
        `
    <aside class="access-story">`,
        `<a class="access-brand" href="#welcome" aria-label="CMUAlert home">${brand}</a>`,
        `<div class="access-story-content">${emblem}<div class="access-story-wordmark">CMU<span>Alert</span>`,
        `</div>`,
        `<p class="access-story-university">City of Malabon University</p>`,
        `<p class="access-story-tagline">Safer campus.<br>Stronger community.</p>`,
        `</div>`,
        `</aside>`,
        `
    <main class="access-main" id="main" tabindex="-1">`,
        `
      <div class="access-top">`,
        `<a href="#welcome">${icon('back')} Back to welcome</a>`,
        `<a href="#announcements">Campus announcements ${icon('arrow')}</a>`,
        `</div>`,
        `
      <div class="access-form-wrap" id="view">`,
        `<a class="access-mobile-brand" href="#welcome" aria-label="CMUAlert home">${logo}<span>CMU<strong>Alert</strong>`,
        `<small>City of Malabon University</small>`,
        `</span>`,
        `</a>`,
        `
        <h1>${setup ? 'Administrator setup' : signup ? 'Create your CMU account' : 'Sign in to CMUAlert'}</h1>
        ${
          error
            ? [
                `<div class="form-error" role="alert">${esc(error)}</div>`,
                `<div class="recovery-actions">`,
                `<button class="btn btn-secondary" data-action="backup-damaged">${icon('download')} Download saved data</button>`,
                `<button class="btn btn-danger-outline" data-action="reset-damaged">Reset unreadable data</button>`,
                `</div>`,
              ].join('')
            : [
                `<form id="access-form" data-kind="${page}">`,
                `<div class="form-error" tabindex="-1" role="alert" hidden>`,
                `</div>
          ${creating ? '<div class="field"><label for="account-name">Full name</label><input id="account-name" name="name" required maxlength="80" autocomplete="name" placeholder="Enter your full name"></div>' : ''}
          ${signup ? '<div class="field"><label for="account-type">University role</label><select id="account-type" name="accountType" required><option value="student">Student</option><option value="faculty">Faculty / staff</option></select></div>' : ''}
          <div class="field">`,
                `<label for="account-username">CMU ID or username</label>`,
                `<div class="access-username">`,
                `<span class="access-input-icon">${icon('user')}</span>`,
                `<input id="account-username" name="username" autocomplete="username" required maxlength="50" ${creating ? 'minlength="3" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}"' : ''} value="${esc(username)}" placeholder="Enter your CMU ID or username">`,
                `</div>${creating ? '<small>Use 3–50 letters, numbers, dots, underscores, or hyphens.</small>' : ''}</div>
          ${passwordField('account-password', creating ? 'Choose password' : 'Password', 'password', creating, setup ? 15 : 8)}${creating ? passwordField('account-confirm', 'Confirm password', 'confirmPassword', true, setup ? 15 : 8) + `<p class="password-hint">${setup ? 15 : 8}–128 characters. Use a unique password.</p>` : ''}
          ${setup ? '<label class="checkbox-label setup-agreement"><input type="checkbox" name="authorized" required><span>I am authorized to manage CMUAlert reports and announcements.</span></label>' : ''}
          <button class="btn btn-primary access-submit" type="submit">${creating ? (setup ? 'Create administrator account' : 'Create account') : 'Sign in'} ${icon('arrow')}</button>`,
                `
        </form>`,
                `<p class="access-alternate">${creating ? 'Already have an account? <a href="#login">Sign in</a>' : 'New to CMUAlert? <a href="#signup">Create an account</a>'}</p>
        ${!creating && !hasAdmin ? '<div class="first-setup"><a href="#setup">Set up the first administrator ' + icon('arrow') + '</a></div>' : ''}`,
              ].join('')
        }
        <div class="access-secondary-links">`,
        `<a href="#track">${icon('search')} Track an anonymous report</a>`,
        `<button data-action="access-help">Sign-in help</button>`,
        `</div>`,
        `
      </div>`,
        `
      <footer class="access-footer">© ${new Date().getFullYear()} CMUAlert <span>City of Malabon University</span>`,
        `</footer>`,
        `
    </main>`,
        `
  </div>`,
      ].join('');
    }

    function publicShell() {
      return [
        `<div class="public-workspace">`,
        `<header class="public-header">`,
        `<a href="#welcome" class="public-brand">${brand}</a>`,
        `<nav aria-label="Public navigation">`,
        `<a href="#announcements">Announcements</a>`,
        `<a href="#track">Track a report</a>`,
        `<a href="#login" class="btn btn-primary">Sign in ${icon('arrow')}</a>`,
        `</nav>`,
        `</header>`,
        `<main id="main" tabindex="-1">`,
        `<div id="storage-warning">`,
        `</div>`,
        `<div id="advisory-banner" aria-live="polite">`,
        `</div>`,
        `<div id="view">`,
        `</div>`,
        `</main>`,
        `<footer class="page-footer">`,
        `<span>© ${new Date().getFullYear()} CMUAlert · City of Malabon University</span>`,
        `</footer>`,
        `</div>`,
      ].join('');
    }

    return { welcomePage, accessPage, publicShell };
  })();
  // 7. Application state, screens, navigation, and event handlers
  __modules['app'] = await (async function () {
    const { createDataService, STORAGE_KEY, ACCOUNT_ROLES, AUDIT_ACTIONS } =
      __modules['data-service'];
    const { createAttachmentStore, validateFiles } = __modules['attachments'];
    const {
      CATEGORIES,
      ALL_CATEGORIES,
      STATUSES,
      TRANSITIONS,
      ANNOUNCEMENT_CATEGORIES,
      AUDIENCES,
      categoryById,
      reportableCategoryById,
      roleLabel,
      isEmergencyAdvisory,
    } = __modules['config'];
    const { icon, campusArt } = __modules['icons'];
    const { accessPage, publicShell, welcomePage } = __modules['access'];

    const app = document.querySelector('#app');
    const dialog = document.querySelector('#dialog');
    const files = createAttachmentStore();
    // localStorage access itself can throw in restricted browser modes.
    const storage = {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    };
    const sessionStore = {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: (key) => window.sessionStorage.removeItem(key),
    };
    const service = createDataService({
      storage,
      sessionStorage: sessionStore,
      attachments: files,
      locks: location.protocol === 'file:' ? null : navigator.locks,
    });
    const escape = (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
    const date = (value, withTime = false) =>
      value && !Number.isNaN(new Date(value).valueOf())
        ? new Intl.DateTimeFormat('en', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
          }).format(new Date(value))
        : '—';
    const localDate = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const selected = (a, b) => (a === b ? ' selected' : '');
    const badge = (status) =>
      [
        `<span class="badge status-${status.toLowerCase().replaceAll(' ', '-')}">`,
        `<span class="status-dot">`,
        `</span>${escape(status)}</span>`,
      ].join('');
    const categoryLabel = (id) => escape(categoryById(id)?.name || id);
    const categoriesForRecords = (records) =>
      ALL_CATEGORIES.filter(
        (c) =>
          CATEGORIES.some((active) => active.id === c.id) ||
          records.some((r) => r.category === c.id),
      );
    const categoryIcon = (id) => {
      const c = categoryById(id);
      return `<span class="icon-tile ${c?.color || 'blue'}">${icon(c?.icon || 'report')}</span>`;
    };
    const button = (label, action, style = 'primary', extra = '') =>
      `<button class="btn btn-${style}" data-action="${action}" ${extra}>${label}</button>`;
    const link = (label, href, style = 'primary') =>
      `<a class="btn btn-${style}" href="${href}">${label}</a>`;
    const empty = (name, title, message, cta = '') =>
      [
        `<div class="empty-state">`,
        `<div class="empty-illustration">${icon(name)}<span class="empty-spark">`,
        `</span>`,
        `</div>`,
        `<h2>${title}</h2>${message ? `<p>${message}</p>` : ''}${cta}</div>`,
      ].join('');
    const callout = (message, type = 'info') =>
      [
        `<div class="callout ${type}">${icon(type === 'warning' ? 'alert' : 'info')}<div>${message}</div>`,
        `</div>`,
      ].join('');
    const heading = (_eyebrow, title, description, action = '') =>
      [
        `<div class="page-heading">`,
        `<div>`,
        `<h1>${title}</h1>${description ? `<p class="page-description">${description}</p>` : ''}</div>${action}</div>`,
      ].join('');
    // Current account, view state, and unsaved forms.
    let role = 'student';
    let currentUser = null;
    let hasAdmin = false;
    let shellIdentity = '';
    let loginUsername = '';
    let preferences = { reporterId: '', displayName: '' };
    let renderId = 0;
    let storageError = '';
    let reportDraft = null;
    let reportStep = 0;
    let receipt = null;
    let tracked = null;
    let trackingOutcome = '';
    let trackingValue = '';
    let trackingRequestId = 0;
    let announcementDraft = null;
    let announcementDirty = false;
    let currentIncident = null;
    let lastHash = location.hash || '#welcome';
    let acceptingNavigation = false;
    let refreshTimer;
    let sessionTimer;
    let reportsLockTimer;
    const defaultReportFilters = () => ({
      query: '',
      category: '',
      status: '',
      fromDate: '',
      toDate: '',
      sort: 'submitted',
    });
    let filters = defaultReportFilters();
    const defaultAdminQueueFilters = () => ({ ...defaultReportFilters(), sort: 'attention' });
    let adminQueueFilters = defaultAdminQueueFilters();
    let adminQueuePage = 0;
    let adminQueueAdvanced = false;
    let announcementFilters = { query: '', category: '', status: '' };
    let accountFilters = { query: '', role: '', status: '' };
    let auditFilters = { query: '', action: '', scope: '' };
    let auditPage = 0;
    let appearance = { theme: 'light', fontSize: 'medium' };
    let settingsTab = 'appearance';
    let onboardingStep = 0;
    let onboardingPreview = false;
    let inboxCurrent = null;
    let activityCache = [];
    const filePreviewURLs = new Map();
    const dirtyReport = () =>
      Boolean(
        reportDraft &&
        (reportDraft.title ||
          reportDraft.description ||
          reportDraft.location ||
          reportDraft.incidentDate ||
          reportDraft.incidentTime ||
          reportDraft.files.length),
      );
    const dirtyAdminForm = () =>
      Boolean(
        document.querySelector(
          '#update-incident-form[data-dirty], #manage-account-form[data-dirty], #reset-account-password-form[data-dirty]',
        ),
      );
    const dirtyProfileForm = () => {
      return [...document.querySelectorAll('#profile-form input')].some(
        (input) => input.value !== input.defaultValue,
      );
    };
    const dirtySettingsForm = () =>
      dirtyProfileForm() ||
      [
        ...document.querySelectorAll(
          '#password-form input, #passcode-form input, #unlock-reports-form input',
        ),
      ].some((input) => input.value !== '') ||
      Boolean(document.querySelector('#message-form[data-dirty], #conversation-form[data-dirty]'));
    const hasUnsavedChanges = () =>
      dirtyReport() || announcementDirty || dirtyAdminForm() || dirtySettingsForm();
    function discardSettingsChanges() {
      document.querySelector('#profile-form')?.reset();
      document.querySelector('#password-form')?.reset();
      document.querySelector('#passcode-form')?.reset();
      document.querySelector('#unlock-reports-form')?.reset();
    }
    const hasReportFilters = () =>
      Object.entries(filters).some(([key, value]) =>
        key === 'sort' ? value !== 'submitted' : Boolean(value),
      );
    const newDraft = (category) => ({
      category: category || '',
      title: '',
      description: '',
      location: '',
      incidentDate: '',
      incidentTime: '',
      mode: 'identified',
      files: [],
      submissionId: crypto.randomUUID(),
    });
    const mobileNavigation = window.matchMedia('(max-width: 1024px)');
    // Responsive navigation and keyboard focus.
    function syncNavigation() {
      const open = mobileNavigation.matches && document.body.classList.contains('nav-open');
      const sidebar = document.querySelector('.sidebar');
      const workspace = document.querySelector('.workspace');
      if (sidebar) sidebar.inert = mobileNavigation.matches && !open;
      if (workspace) workspace.inert = open;
      document.querySelector('.mobile-menu')?.setAttribute('aria-expanded', String(open));
    }
    function closeNavigation(restoreFocus = false) {
      document.body.classList.remove('nav-open');
      syncNavigation();
      if (restoreFocus) document.querySelector('.mobile-menu')?.focus();
    }
    mobileNavigation.addEventListener('change', () => closeNavigation());

    // Shared feedback, dialogs, and form submission helpers.
    function toast(message, type = 'success') {
      const item = document.createElement('div');
      item.className = `toast ${type}`;
      item.innerHTML = [
        `${icon(type === 'success' ? 'check-circle' : 'alert')}<span>${escape(message)}</span>`,
        `<button aria-label="Dismiss message">${icon('close')}</button>`,
      ].join('');
      item.querySelector('button').onclick = () => item.remove();
      document.querySelector('#toasts').append(item);
      setTimeout(() => item.remove(), type === 'error' ? 14000 : 6500);
    }

    function openDialog(title, body, footer = '') {
      const fromDrawer = mobileNavigation.matches && document.body.classList.contains('nav-open');
      if (fromDrawer) closeNavigation();
      if (dialog.open) dialog.close();
      dialog.returnValue = 'cancel';
      dialog.innerHTML = [
        `<div class="dialog-heading">`,
        `<h2 id="dialog-title">${title}</h2>`,
        `<button class="icon-button" data-dialog-close aria-label="Close dialog">${icon('close')}</button>`,
        `</div>`,
        `<div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`,
      ].join('');
      dialog.querySelector('[data-dialog-close]').onclick = () => dialog.close('cancel');
      dialog.showModal();
      if (fromDrawer)
        dialog.addEventListener('close', () => document.querySelector('.mobile-menu')?.focus(), {
          once: true,
        });
    }
    function confirmAction(title, message, confirmLabel, danger = false) {
      return new Promise((resolve) => {
        openDialog(
          title,
          message,
          [
            `<button class="btn btn-secondary" id="cancel-confirm">Cancel</button>`,
            `<button class="btn btn-${danger ? 'danger' : 'primary'}" id="accept-confirm">${confirmLabel}</button>`,
          ].join(''),
        );
        let settled = false;
        const finish = (accepted, closeDialog = true) => {
          if (settled) return;
          settled = true;
          dialog.removeEventListener('cancel', cancel);
          dialog.removeEventListener('close', closed);
          if (closeDialog) dialog.close(accepted ? 'confirm' : 'cancel');
          resolve(accepted);
        };
        const cancel = (event) => {
          event.preventDefault();
          finish(false);
        };
        const closed = () => {
          if (!dialog.open) finish(false, false);
        };
        dialog.querySelector('#cancel-confirm').onclick = () => finish(false);
        dialog.querySelector('#accept-confirm').onclick = () => finish(true);
        dialog.querySelector('[data-dialog-close]').onclick = () => finish(false);
        dialog.addEventListener('cancel', cancel);
        dialog.addEventListener('close', closed);
        dialog.querySelector('#cancel-confirm').focus();
      });
    }
    // Keep validation messages beside their controls and linked for assistive technology.
    function validationControl(input) {
      if (input.type === 'radio' && input.name) {
        return (
          input.form.querySelector(`input[type="radio"][name="${CSS.escape(input.name)}"]`) || input
        );
      }
      return input;
    }
    function clearFieldError(input) {
      input = validationControl(input);
      const messageId = input.dataset.errorMessage;
      if (!messageId) return;
      document.getElementById(messageId)?.remove();
      const describedBy = (input.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== messageId);
      if (describedBy.length) input.setAttribute('aria-describedby', describedBy.join(' '));
      else input.removeAttribute('aria-describedby');
      input.removeAttribute('aria-invalid');
      delete input.dataset.errorMessage;
    }
    function fieldError(input, message) {
      input = validationControl(input);
      clearFieldError(input);
      if (!input.id) input.id = `field-${crypto.randomUUID()}`;
      const element = document.createElement('p');
      element.id = `${input.id}-error`;
      element.className = 'field-error';
      element.textContent = message;
      const container =
        input.closest('.field, fieldset') || input.closest('label') || input.parentElement;
      if (container.matches('label')) container.after(element);
      else container.append(element);
      input.dataset.errorMessage = element.id;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute(
        'aria-describedby',
        [
          ...new Set([
            ...(input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
            element.id,
          ]),
        ].join(' '),
      );
    }
    function syncFormConstraints(form) {
      const password = form.elements.namedItem('password');
      const confirmation = form.elements.namedItem('confirmPassword');
      if (password && confirmation)
        confirmation.setCustomValidity(
          confirmation.value && password.value !== confirmation.value
            ? 'Passwords do not match.'
            : '',
        );
      const from = form.elements.namedItem('fromDate');
      const through = form.elements.namedItem('toDate');
      if (from && through)
        through.setCustomValidity(
          from.value && through.value && from.value > through.value
            ? 'End date must be on or after start date.'
            : '',
        );
    }
    function validationMessage(input) {
      if (input.validity.customError) return input.validationMessage;
      if (input.validity.valueMissing) {
        if (input.type === 'radio') return 'Select an option to continue.';
        if (input.type === 'checkbox') return 'Confirm this statement to continue.';
      }
      const label =
        input.labels?.[0]?.textContent.replace(/\*/g, '').replace(/\s+/g, ' ').trim() ||
        'This field';
      if (
        (input.required &&
          !['radio', 'checkbox', 'password'].includes(input.type) &&
          !input.value.trim()) ||
        input.validity.valueMissing
      )
        return `${label} is required.`;
      if (input.validity.patternMismatch && input.name === 'username')
        return 'Use 3–50 letters, numbers, dots, underscores, or hyphens.';
      if (input.minLength > 0 && input.value && input.value.length < input.minLength)
        return `Use at least ${input.minLength} characters.`;
      if (input.maxLength > 0 && input.value.length > input.maxLength)
        return `Use ${input.maxLength} characters or fewer.`;
      return input.validity.valid ? '' : input.validationMessage;
    }
    function validateControl(input) {
      if (!input.willValidate) return '';
      const message = validationMessage(input);
      if (message) fieldError(input, message);
      else clearFieldError(input);
      return message;
    }
    function clearFormSummary(form) {
      const box = form.querySelector('.form-error');
      if (box) {
        box.hidden = true;
        box.textContent = '';
      }
      delete form.dataset.validationSummary;
    }
    document.addEventListener(
      'invalid',
      (event) => {
        if (event.target.matches('input, select, textarea')) validateControl(event.target);
      },
      true,
    );
    document.addEventListener('input', (event) => {
      const input = event.target;
      if (!input.matches('input, select, textarea') || !input.form) return;
      syncFormConstraints(input.form);
      if (validationControl(input).getAttribute('aria-invalid') === 'true') validateControl(input);
      for (const name of ['confirmPassword', 'toDate']) {
        const dependent = input.form.elements.namedItem(name);
        if (dependent?.getAttribute('aria-invalid') === 'true') validateControl(dependent);
      }
      if (
        input.form.dataset.validationSummary &&
        !input.form.querySelector('[aria-invalid="true"]')
      )
        clearFormSummary(input.form);
    });
    document.addEventListener('focusout', (event) => {
      const input = event.target;
      if (!input.matches('input, select, textarea') || !input.form || !input.isConnected) return;
      // Validate an empty tracking query on submit, so clearing it does not move the buttons.
      if (input.form.id === 'tracking-form' && !input.value.trim()) return;
      syncFormConstraints(input.form);
      validateControl(input);
    });
    document.addEventListener(
      'submit',
      (event) => {
        const form = event.target;
        syncFormConstraints(form);
        let firstInvalid = null,
          firstMessage = '';
        for (const input of form.querySelectorAll('input, select, textarea')) {
          const message = validateControl(input);
          if (message && !firstInvalid) {
            firstInvalid = validationControl(input);
            firstMessage = message;
          }
        }
        if (firstInvalid) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const box = form.querySelector('.form-error');
          if (box) {
            box.textContent = firstMessage;
            box.hidden = false;
            form.dataset.validationSummary = 'true';
          }
          firstInvalid.focus();
        } else clearFormSummary(form);
      },
      true,
    );
    function formError(form, error) {
      const box = form.querySelector('.form-error');
      if (box) {
        box.textContent = error.message;
        box.hidden = false;
      } else toast(error.message, 'error');
      let field = error.field;
      if (!field) {
        if (/passwords do not match/i.test(error.message)) field = 'confirmPassword';
        else if (
          /current password|administrator password is incorrect/i.test(error.message) ||
          (error.code === 'credentials' && form.elements.namedItem('currentPassword'))
        )
          field = 'currentPassword';
        else {
          const labels = [
            ['Incident title', 'title'],
            ['Description', 'description'],
            ['Location', 'location'],
            ['Full name', form.elements.namedItem('displayName') ? 'displayName' : 'name'],
            ['CMU ID or username', 'username'],
            ['Reason for', 'reason'],
          ];
          field = labels.find(([label]) => error.message.startsWith(label))?.[1];
        }
      }
      const input = field && form.elements.namedItem(field);
      if (input?.matches?.('input, select, textarea')) {
        fieldError(input, error.message);
        form.dataset.validationSummary = 'true';
        input.focus();
      } else box?.focus();
    }
    async function saving(form, task) {
      if (form.dataset.busy) return;
      form.dataset.busy = 'true';
      form.setAttribute('aria-busy', 'true');
      const buttons = [...form.querySelectorAll('button[type="submit"]')];
      const originals = buttons.map((button) => button.innerHTML);
      const message =
        form.id === 'access-form' && form.dataset.kind === 'login'
          ? 'Signing in…'
          : form.id === 'submit-report-form'
            ? 'Submitting…'
            : form.id === 'tracking-form'
              ? 'Finding report…'
              : ['admin-queue-filters', 'report-filters'].includes(form.id)
                ? 'Searching…'
                : 'Saving…';
      buttons.forEach((button) => {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = [
          `<span class="button-spinner" aria-hidden="true">`,
          `</span>${message}`,
        ].join('');
      });
      try {
        await task();
      } catch (error) {
        formError(form, error);
      } finally {
        delete form.dataset.busy;
        form.removeAttribute('aria-busy');
        buttons.forEach((button, i) => {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.innerHTML = originals[i];
        });
      }
    }

    function confirmDataReset(damagedOnly) {
      return new Promise((resolve) => {
        openDialog(
          'Reset all CMUAlert browser data?',
          [
            '<p>This permanently removes <strong>all local accounts, activity logs, reports, history, internal notes, announcements, attachments, and preferences</strong> saved by CMUAlert in this browser.</p>',
            '<p>Other browser storage is preserved. This action cannot be undone. Download a copy of your saved records first if needed.</p>',
            '<form id="reset-data-form"><div class="form-error" tabindex="-1" role="alert" hidden></div>',
            damagedOnly
              ? ''
              : '<div class="field"><label for="reset-data-password">Your administrator password</label><input id="reset-data-password" name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></div>',
            '<div class="form-actions"><button type="button" class="btn btn-secondary" id="cancel-confirm">Cancel</button><button type="submit" class="btn btn-danger" id="accept-confirm">Delete CMUAlert data</button></div></form>',
          ].join(''),
        );
        const form = dialog.querySelector('#reset-data-form');
        const cancel = dialog.querySelector('#cancel-confirm');
        const close = dialog.querySelector('[data-dialog-close]');
        let settled = false;
        const finish = (accepted, closeDialog = true) => {
          if (settled) return;
          settled = true;
          dialog.removeEventListener('cancel', cancelReset);
          dialog.removeEventListener('close', closed);
          form.reset();
          if (closeDialog) dialog.close(accepted ? 'confirm' : 'cancel');
          resolve(accepted);
        };
        const cancelReset = (event) => {
          event?.preventDefault();
          if (!form.dataset.busy) finish(false);
        };
        const closed = () => {
          if (!dialog.open) finish(false, false);
        };
        dialog.addEventListener('cancel', cancelReset);
        dialog.addEventListener('close', closed);
        cancel.onclick = cancelReset;
        close.onclick = cancelReset;
        form.onsubmit = (event) => {
          event.preventDefault();
          saving(form, async () => {
            cancel.disabled = true;
            close.disabled = true;
            try {
              await service.reset({
                damagedOnly,
                currentPassword: form.elements.namedItem('currentPassword')?.value,
              });
              finish(true);
            } finally {
              cancel.disabled = false;
              close.disabled = false;
            }
          });
        };
        cancel.focus();
      });
    }

    // Application shell and route rendering.
    function shell() {
      shellIdentity = currentUser?.id || 'public';
      if (!currentUser) {
        app.innerHTML = publicShell();
        return;
      }
      const admin = role === 'admin';
      const nav = admin
        ? [
            ['dashboard', 'dashboard', 'Dashboard'],
            ['reports', 'report', 'Incident Reports'],
            ['accounts', 'users', 'User Management'],
            ['announcements', 'megaphone', 'Announcements'],
            ['audit', 'clock', 'Activity Log'],
            ['settings', 'settings', 'Settings'],
          ]
        : [
            ['dashboard', 'dashboard', 'Home'],
            ['report/new', 'megaphone', 'Report'],
            ['reports', 'report', 'My reports'],
            ['inbox', 'inbox', 'Inbox'],
            ['track', 'search', 'Track anonymous report'],
            ['announcements', 'megaphone', 'Announcements'],
          ];
      app.innerHTML = [
        `<div class="sidebar-overlay" data-action="close-nav">`,
        `</div>`,
        `<aside class="sidebar ${admin ? 'admin-sidebar' : ''}" aria-label="Main navigation">`,
        `
    <button class="icon-button mobile-sidebar-close" data-action="close-nav" aria-label="Close navigation">${icon('close')}</button>`,
        `<a href="#dashboard" class="brand">`,
        `<span class="university-mark">`,
        `<img src="assets/cmu-logo.png" alt="City of Malabon University logo" width="400" height="416">`,
        `</span>`,
        `<span class="brand-text">CMU<span>Alert</span>`,
        `<small>City of Malabon University</small>`,
        `</span>`,
        `</a>`,
        `
    <div class="signed-in-workspace">${icon(admin ? 'shield' : 'user')}<div>`,
        `<small>SIGNED IN AS</small>`,
        `<strong>${roleLabel(role)}</strong>`,
        `</div>`,
        `<span class="live-dot">`,
        `</span>`,
        `</div>`,
        `
    <div class="nav-label">${admin ? 'MANAGE CAMPUS SAFETY' : 'YOUR CAMPUS SPACE'}</div>`,
        `<nav aria-label="Workspace pages">${nav
          .map(([route, name, text]) =>
            [
              `<a href="#${route}" data-route="${route}">${icon(name)}<span>${text}</span>`,
              `<span class="nav-active-dot">`,
              `</span>`,
              `</a>`,
            ].join(''),
          )
          .join('')}</nav>`,
        `
    <div class="sidebar-bottom">`,
        `<div class="campus-note">`,
        `<span class="campus-note-icon">${icon('shield')}</span>`,
        `<p>A safer campus.<br>`,
        `<strong>A stronger community.</strong>`,
        `</p>`,
        `<span class="gold-line">`,
        `</span>`,
        `</div>`,
        `<nav aria-label="Account and help">`,
        `${admin ? `<a href="#inbox" data-route="inbox">${icon('inbox')}<span>Inbox</span></a>` : ''}`,
        `<a href="#profile" data-route="profile">${icon('user')}<span>Profile</span></a>`,
        `${admin ? '' : `<a href="#settings" data-route="settings">${icon('settings')}<span>Settings</span></a>`}`,
        `<button data-action="help">${icon('help')}<span>Help & reporting guide</span>`,
        `</button>`,
        `<button data-action="sign-out">${icon('logout')}<span>Sign out</span>`,
        `</button>`,
        `</nav>`,
        `</div>`,
        `
  </aside>`,
        `<div class="workspace ${admin ? 'admin-workspace' : ''}">`,
        `<header class="topbar">`,
        `<div class="topbar-left">`,
        `<button class="icon-button mobile-menu" data-action="toggle-nav" aria-label="Open navigation" aria-expanded="false">${icon('menu')}</button>`,
        `<span class="topbar-institution">Campus safety portal</span>`,
        `<span class="topbar-divider">/</span>`,
        `<span id="breadcrumb">Overview</span>`,
        `</div>`,
        `<div class="topbar-right">`,
        `<button class="icon-button top-help" data-action="help" aria-label="Help & reporting guide">${icon('help')}</button>`,
        `<a class="icon-button notification-bell" href="#notifications" aria-label="Notifications">${icon('bell')}<span class="notification-count" hidden></span></a>`,
        `<a class="user-chip" href="#profile" title="Open profile">`,
        `<span class="avatar">${avatarContent()}</span>`,
        `<span>`,
        `<small class="personal-greeting">${greeting()}</small>`,
        `<strong>${escape(preferences.displayName)}</strong>`,
        `<small>${admin ? 'Security office & administration' : role === 'faculty' ? 'Faculty & staff workspace' : 'Student workspace'}</small>`,
        `</span>${icon('down')}</a>`,
        `</div>`,
        `</header>`,
        `
    <main id="main" tabindex="-1">`,
        `<div id="storage-warning">`,
        `</div>`,
        `<div id="advisory-banner" aria-live="polite">`,
        `</div>`,
        `<div id="view" aria-live="off">`,
        `</div>`,
        `</main>`,
        `<footer class="page-footer">`,
        `<span>© ${new Date().getFullYear()} CMUAlert <span class="footer-dot">·</span> City of Malabon University</span>`,
        `</footer>`,
        `</div>`,
        `<nav class="bottom-navigation" aria-label="Quick navigation">${(admin
          ? [
              ['dashboard', 'dashboard', 'Home'],
              ['reports', 'report', 'Reports'],
              ['accounts', 'users', 'Users'],
              ['announcements', 'megaphone', 'Updates'],
              ['settings', 'settings', 'Settings'],
            ]
          : [
              ['dashboard', 'dashboard', 'Home'],
              ['inbox', 'inbox', 'Inbox'],
              ['report/new', 'megaphone', 'Report'],
              ['profile', 'user', 'Profile'],
              ['settings', 'settings', 'Settings'],
            ]
        )
          .map(
            ([route, name, label]) =>
              `<a href="#${route}" data-route="${route}" class="${route === 'report/new' ? 'primary-nav-action' : ''}"><span>${icon(name)}</span><small>${label}</small></a>`,
          )
          .join('')}</nav>`,
      ].join('');
    }

    async function render({ focus = false } = {}) {
      const ticket = ++renderId;
      try {
        applyAppearance(await service.getAppearance());
        currentUser = await service.getSession();
        hasAdmin = (await service.getAccessState()).hasAdmin;
        if (currentUser) {
          role = currentUser.role;
          preferences = await service.getPreferences();
        }
        storageError = '';
      } catch (error) {
        storageError = error.code === 'unauthenticated' ? '' : error.message;
        currentUser = null;
      }
      if (ticket !== renderId) return;
      clearTimeout(sessionTimer);
      clearTimeout(reportsLockTimer);
      if (currentUser && !currentUser.mustChangePassword) {
        try {
          const access = await service.getReportsAccess();
          if (ticket !== renderId) return;
          if (access.enabled && access.unlockedUntil && access.unlocked)
            reportsLockTimer = setTimeout(
              () => {
                currentIncident = null;
                if (dialog.open) dialog.close('cancel');
                const path = location.hash.split('?')[0];
                if (path.startsWith('#reports') || path === '#dashboard') render();
              },
              Math.max(0, Date.parse(access.unlockedUntil) - Date.now()),
            );
        } catch {
          clearLocalView();
          return render({ focus });
        }
      }
      if (currentUser?.sessionExpiresAt)
        sessionTimer = setTimeout(
          () => {
            clearLocalView();
            render();
          },
          Math.max(0, Date.parse(currentUser.sessionExpiresAt) - Date.now()),
        );
      const path = (location.hash.slice(1) || (currentUser ? 'dashboard' : 'welcome')).split(
        '?',
      )[0];
      if (path === 'welcome' && !storageError) {
        app.innerHTML = welcomePage({ hasAdmin, signedIn: Boolean(currentUser) });
        shellIdentity = 'welcome';
        document.body.classList.remove('nav-open');
        await refreshAdvisoryBanner();
        if (ticket !== renderId) return;
        if (focus) {
          document.querySelector('#main').focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        return;
      }
      const accessRoute = ['login', 'signup', 'setup'].includes(path);
      if (
        storageError ||
        (!currentUser && (accessRoute || !['announcements', 'track'].includes(path)))
      ) {
        app.innerHTML = accessPage({
          page: path === 'signup' ? 'signup' : path === 'setup' && !hasAdmin ? 'setup' : 'login',
          hasAdmin,
          error: storageError,
          username: loginUsername,
        });
        shellIdentity = 'access';
        document.body.classList.remove('nav-open');
        bindAccess();
        if (focus) document.querySelector('#main').focus({ preventScroll: true });
        return;
      }
      if (currentUser && accessRoute) {
        location.hash = '#dashboard';
        return;
      }
      if (currentUser?.mustChangePassword && path !== 'settings') {
        location.hash = '#settings';
        return;
      }
      if (path === 'report/new' && currentUser && !ACCOUNT_ROLES.includes(currentUser.role)) {
        reportDraft = null;
        reportStep = 0;
        receipt = null;
        location.replace('#reports');
        return;
      }
      if (!document.querySelector('#view') || shellIdentity !== (currentUser?.id || 'public'))
        shell();
      syncNavigation();
      await refreshActivityBadge();
      await refreshAdvisoryBanner();
      if (ticket !== renderId) return;
      document.querySelectorAll('[data-route]').forEach((a) => {
        const active =
          path === a.dataset.route ||
          (['reports', 'announcements', 'accounts', 'profile', 'inbox'].includes(a.dataset.route) &&
            path.startsWith(a.dataset.route + '/'));
        a.classList.toggle('active', active);
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
      document.querySelector('#storage-warning').innerHTML = storageError
        ? callout(`${escape(storageError)} <a href="#settings">Open settings</a>`, 'warning')
        : '';
      const labels = {
        dashboard: role === 'admin' ? 'Dashboard' : 'Overview',
        'report/new': 'Report an incident',
        reports: role === 'admin' ? 'Incident reports' : 'My reports',
        track: 'Track anonymous report',
        announcements: 'Announcements',
        settings: 'Settings',
        profile: 'Profile',
        inbox: 'Inbox',
        notifications: 'Notifications',
        accounts: 'User Management',
        audit: 'Activity Log',
      };
      if (document.querySelector('#breadcrumb'))
        document.querySelector('#breadcrumb').textContent =
          labels[path] ||
          (path.startsWith('reports/')
            ? 'Report details'
            : path.startsWith('accounts/')
              ? 'Manage account'
              : 'Announcements');
      try {
        let html;
        if (path === 'dashboard') html = await dashboard();
        else if (path === 'report/new' && currentUser) html = reportWizard();
        else if (path === 'reports') html = await reportList();
        else if (path.startsWith('reports/')) html = await incidentDetail(path.split('/')[1]);
        else if (path === 'track') html = trackingPage();
        else if (path === 'announcements') html = await announcementsPage();
        else if (path === 'announcements/new' && role === 'admin') html = announcementEditor();
        else if (path.startsWith('announcements/edit/') && role === 'admin') {
          const record = await service.getAnnouncement(path.split('/')[2], { role });
          announcementDraft ??= record;
          html = announcementEditor(announcementDraft);
        } else if (
          (path === 'accounts' || path.startsWith('accounts/') || path === 'audit') &&
          role !== 'admin'
        )
          html =
            heading('', 'Administrator access required', '') +
            empty(
              'lock',
              'This page is restricted',
              'Sign in with an administrator account to manage accounts and view the activity log.',
              link('Back to overview', '#dashboard'),
            );
        else if (path === 'accounts') html = await accountsPage();
        else if (path === 'accounts/new') html = accountEditor();
        else if (path.startsWith('accounts/edit/'))
          html = accountEditor(await service.getAccount(path.split('/')[2]));
        else if (path === 'audit') html = await auditLogPage();
        else if (path === 'inbox') html = await inboxPage();
        else if (path === 'inbox/new' && role === 'admin') html = await newConversationPage();
        else if (path.startsWith('inbox/')) html = await conversationPage(path.split('/')[1]);
        else if (path === 'notifications') html = await notificationsPage();
        else if (path === 'profile') html = profilePage();
        else if (path === 'profile/details') html = accountSettingsPage();
        else if (path === 'profile/passcode' && role !== 'admin') html = passcodePage();
        else if (path === 'settings')
          html = currentUser.mustChangePassword ? accountSettingsPage() : settingsPage();
        else
          html = empty(
            'search',
            'Page unavailable',
            'Use the navigation to continue in your current workspace.',
            link('Back to overview', '#dashboard'),
          );
        if (ticket !== renderId) return;
        document.querySelector('#view').innerHTML = html;
        bindView();
        if (focus) {
          document.querySelector('#main').focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
      } catch (error) {
        if (ticket === renderId)
          document.querySelector('#view').innerHTML = empty(
            'alert',
            'We couldn’t open this page',
            escape(error.message),
            link('Go to settings', '#settings', 'secondary'),
          );
      }
    }

    async function refreshAdvisoryBanner() {
      const container = document.querySelector('#advisory-banner');
      if (!container) return;
      try {
        const announcements = await service.listAnnouncements({
          role: currentUser?.role || 'public',
          publishedOnly: true,
        });
        const urgent = announcements.filter(isEmergencyAdvisory);
        const latest = urgent[0];
        const html = latest
          ? [
              `<section class="emergency-banner" aria-label="Emergency advisory">`,
              `
      <span class="emergency-symbol">${icon('alert')}</span>`,
              `<div>`,
              `<p class="eyebrow">EMERGENCY ADVISORY <span>${date(latest.publishedAt, true)}</span>`,
              `</p>`,
              `<h2>${escape(latest.title)}</h2>`,
              `<p>${escape(latest.content.slice(0, 180))}${latest.content.length > 180 ? '…' : ''}</p>`,
              `<div class="emergency-actions">${button('Read full advisory ' + icon('arrow'), 'read-announcement', 'text', `data-id="${latest.id}"`)}${urgent.length > 1 ? `<a href="#announcements">View all ${urgent.length} emergency advisories</a>` : ''}</div>`,
              `</div>`,
              `
    </section>`,
            ].join('')
          : '';
        if (
          document.querySelector('#advisory-banner') === container &&
          container.innerHTML !== html
        )
          container.innerHTML = html;
      } catch (error) {
        if (document.querySelector('#advisory-banner') === container)
          container.innerHTML = callout(
            'Safety advisories could not be refreshed. ' + escape(error.message),
            'warning',
          );
      }
    }

    // Dashboard and incident reporting screens.
    // HTML fragments join without separators to preserve form values and text exactly.
    // Admin views share the same shell and service, with task-specific content.
    function reportSafetyMark(report) {
      if (report.category !== 'weapon') return '';
      const active = !['Resolved', 'Closed'].includes(report.status);
      return `<span class="report-safety-mark ${active ? 'active-safety' : ''}">${icon('shield-alert')}${active ? 'Safety priority · Weapon-related' : 'Weapon-related concern'}</span>`;
    }

    function adminActivityLink(entry) {
      if (!entry.resource) return '';
      const href =
        entry.resource.type === 'incident'
          ? `#reports/${entry.resource.id}`
          : `#announcements/edit/${entry.resource.id}`;
      return `<a class="activity-resource" href="${href}">${escape(entry.resource.label)}${icon('chevron')}</a>`;
    }

    async function adminQueue({ compact = false } = {}) {
      const [records, all] = await Promise.all([
        service.listReports({ role: 'admin', ...adminQueueFilters }),
        service.listReports({ role: 'admin' }),
      ]);
      const limit = compact ? 6 : 12;
      adminQueuePage = compact
        ? 0
        : Math.min(adminQueuePage, Math.max(0, Math.ceil(records.length / limit) - 1));
      const start = adminQueuePage * limit;
      const filtered = Object.entries(adminQueueFilters).some(([key, value]) =>
        key === 'sort' ? value !== 'attention' : Boolean(value),
      );
      return `<section class="panel admin-queue" aria-labelledby="queue-title">
        <div class="panel-heading"><div><h2 id="queue-title">Incident queue</h2><p>Find a report and review its progress.</p></div>${compact ? '<a class="text-link" href="#reports">View all ' + icon('arrow') + '</a>' : `<span class="count-pill">${all.length} total</span>`}</div>
        <form id="admin-queue-filters" class="admin-queue-filters">
          <div class="queue-filter-main">
            <div class="queue-search"><label for="queue-search">Search reports</label><div class="input-with-icon">${icon('search')}<input id="queue-search" name="query" type="search" maxlength="160" value="${escape(adminQueueFilters.query)}" placeholder="Reference, title, or location"></div></div>
            <div><label for="queue-category">Category</label><select id="queue-category" name="category"><option value="">All categories</option>${categoriesForRecords(
              all,
            )
              .map(
                (c) =>
                  `<option value="${c.id}"${selected(adminQueueFilters.category, c.id)}>${escape(c.short)}</option>`,
              )
              .join('')}</select></div>
            <div><label for="queue-status">Status</label><select id="queue-status" name="status"><option value="">All statuses</option>${STATUSES.map((status) => `<option value="${status}"${selected(adminQueueFilters.status, status)}>${status === 'Submitted' ? 'Pending · Submitted' : status}</option>`).join('')}</select></div>
            <button class="btn btn-secondary" type="submit">${icon('search')} Search</button>
          </div>
          <details class="queue-advanced"${adminQueueAdvanced ? ' open' : ''}><summary>Dates & sorting${icon('down')}</summary><div class="queue-advanced-fields">
            <div><label for="queue-from">Submitted from</label><input type="date" id="queue-from" name="fromDate" value="${escape(adminQueueFilters.fromDate)}"></div>
            <div><label for="queue-to">Submitted through</label><input type="date" id="queue-to" name="toDate" value="${escape(adminQueueFilters.toDate)}"></div>
            <div><label for="queue-sort">Sort reports</label><select id="queue-sort" name="sort">${[
              ['attention', 'Needs attention'],
              ['submitted', 'Newest submitted'],
              ['oldest', 'Oldest submitted'],
              ['updated', 'Recently updated'],
            ]
              .map(
                ([value, label]) =>
                  `<option value="${value}"${selected(adminQueueFilters.sort, value)}>${label}</option>`,
              )
              .join('')}</select></div>
          </div></details>
          <div class="form-error" role="alert" tabindex="-1" hidden></div>
        </form>
        <div class="queue-results"><p role="status">${records.length} matching report${records.length === 1 ? '' : 's'}${records.length ? ` · Showing ${start + 1}–${Math.min(start + limit, records.length)}` : ''}</p>${filtered && records.length ? button('Clear filters', 'clear-admin-queue', 'text') : ''}</div>
        ${adminQueueFilters.sort === 'attention' && records.length ? `<p class="queue-order-note">${icon('info')}Active weapon-related concerns first, then report status and oldest submission.</p>` : ''}
        ${
          records.length
            ? `<div class="queue-column-head" aria-hidden="true"><span>Incident</span><span>Category</span><span>Status</span><span>Submitted</span><span>Action</span></div><ol class="admin-queue-list">${records
                .slice(start, start + limit)
                .map(
                  (
                    report,
                  ) => `<li class="admin-report-card${report.category === 'weapon' && !['Resolved', 'Closed'].includes(report.status) ? ' priority-report' : ''}">
          <div class="queue-incident"><span class="queue-reference">${escape(report.reference)}</span>${reportSafetyMark(report)}<h3><a href="#reports/${report.id}">${escape(report.title)}</a></h3><span class="queue-location">${icon('pin')}${escape(report.location) || 'Location not provided'}</span><small>${report.mode === 'anonymous' ? 'Anonymous report' : 'Identified report'} · Updated ${date(report.updatedAt)}</small></div>
          <div class="queue-category"><span class="queue-field-label">Category</span>${categoryIcon(report.category)}<span>${escape(categoryById(report.category)?.short || report.category)}</span></div>
          <div class="queue-status"><span class="queue-field-label">Status</span>${badge(report.status)}</div>
          <div class="queue-submitted"><span class="queue-field-label">Submitted</span><time datetime="${report.createdAt}">${date(report.createdAt, true)}</time></div>
          <a class="btn btn-secondary queue-review" href="#reports/${report.id}" aria-label="Review report ${escape(report.reference)}">Review ${icon('chevron')}</a>
        </li>`,
                )
                .join('')}</ol>
        ${compact ? (records.length > limit ? `<div class="queue-footer"><span>${records.length - limit} more matching reports</span><a class="text-link" href="#reports">Open full queue ${icon('arrow')}</a></div>` : '') : `<div class="queue-footer"><span>Page ${adminQueuePage + 1} of ${Math.ceil(records.length / limit)}</span><div>${button(icon('back') + ' Previous', 'queue-previous', 'secondary', adminQueuePage === 0 ? 'disabled' : '')}${button('Next ' + icon('arrow'), 'queue-next', 'secondary', start + limit >= records.length ? 'disabled' : '')}</div></div>`}`
            : empty(
                filtered ? 'search' : 'report',
                filtered ? 'No matching reports' : 'No incident reports yet',
                filtered
                  ? 'Try another reference, category, status, or date range.'
                  : 'Reports submitted by students and staff will appear here.',
                filtered ? button('Clear filters', 'clear-admin-queue', 'secondary') : '',
              )
        }
      </section>`;
    }

    async function adminReportsPage() {
      return `${heading('', 'Incident Reports', 'Review submitted concerns, record actions, and share progress with reporters.', link(icon('clock') + ' Activity log', '#audit', 'secondary'))}${await adminQueue()}`;
    }

    function adminCategorySummary(summary) {
      const categories = ALL_CATEGORIES.filter(
        (category) =>
          CATEGORIES.some((active) => active.id === category.id) ||
          summary.categories[category.id] > 0,
      );
      return `<section class="panel admin-category-summary">
        <div class="panel-heading"><div><h2>Reports by category</h2><p>${summary.total} total reports</p></div>${icon('chart')}</div>
        ${
          summary.total
            ? `<div class="admin-category-rows">${categories
                .map(
                  (category) => `<div>
          ${categoryIcon(category.id)}<div><span>${escape(category.name)}</span><div class="bar-track" aria-hidden="true"><span class="bar ${category.color}" style="width:${(summary.categories[category.id] / summary.total) * 100}%"></span></div></div><strong>${summary.categories[category.id]}<span class="sr-only"> reports</span></strong>
        </div>`,
                )
                .join('')}</div>`
            : empty('chart', 'No category data yet', 'The breakdown will use submitted reports.')
        }
      </section>`;
    }

    async function adminDashboard() {
      const [summary, reports, announcements, activity] = await Promise.all([
        service.getSummary({ role: 'admin' }),
        service.listReports({ role: 'admin', sort: 'attention' }),
        service.listAnnouncements({ role: 'admin' }),
        service.listAuditLog(),
      ]);
      const activeWeapons = reports.filter(
        (r) => r.category === 'weapon' && !['Resolved', 'Closed'].includes(r.status),
      );
      const published = announcements.filter((a) => a.status === 'Published');
      const emergency = published.filter(isEmergencyAdvisory);
      const stats = [
        ['Pending', 'Submitted', 'Awaiting review', 'report', 'amber'],
        ['Under review', 'Under Review', 'Assessment underway', 'eye', 'purple'],
        ['In progress', 'In Progress', 'Action being taken', 'clock', 'blue'],
        ['Resolved', 'Resolved', 'Resolution documented', 'check-circle', 'teal'],
      ];
      return `${heading('', 'Dashboard', 'Review campus concerns and keep your community informed.', link(icon('plus') + ' Create announcement', '#announcements/new'))}
        <div class="admin-welcome"><span class="hero-label">${icon('shield')} CMUAlert · Administration</span><p>${greeting()}, <strong>${escape(preferences.displayName)}</strong>. ${summary.total} total report${summary.total === 1 ? '' : 's'} · ${summary.statuses.Closed} closed.</p></div>
        ${!preferences.onboardingDismissed || onboardingPreview ? onboardingGuide() : ''}
        <section class="stats-grid admin-summary-grid" aria-label="Campus report summary">${stats.map(([label, status, description, symbol, color]) => `<button class="stat-card admin-summary-card" data-action="view-status" data-status="${status}"><span class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon(symbol)}</span></span><strong>${summary.statuses[status]}</strong><span class="admin-stat-caption">${description}${icon('arrow')}</span><span class="sr-only">View ${status} reports</span></button>`).join('')}</section>
        ${activeWeapons.length || emergency.length ? `<section class="admin-attention" aria-labelledby="attention-title"><span class="attention-symbol">${icon('shield-alert')}</span><div><h2 id="attention-title">Safety attention</h2><p>${activeWeapons.length} active weapon-related report${activeWeapons.length === 1 ? '' : 's'} · ${emergency.length} published emergency advisor${emergency.length === 1 ? 'y' : 'ies'}</p></div><div class="attention-actions">${activeWeapons.length ? button('Review weapon concerns', 'view-weapon-reports', 'secondary') : ''}${emergency.length ? button('Emergency announcements', 'view-emergency-announcements', 'secondary') : ''}</div></section>` : ''}
        <div class="admin-dashboard-layout"><div class="admin-main-column">${await adminQueue({ compact: true })}</div><aside class="admin-support-column" aria-label="Administrative tools and activity">
          <section class="panel admin-tools"><div class="panel-heading"><h2>Workspace shortcuts</h2></div><nav aria-label="Administrative shortcuts">${[
            ['accounts', 'users', 'User Management', 'Manage student and staff access'],
            ['announcements/new', 'megaphone', 'Create announcement', 'Prepare a campus update'],
            ['inbox', 'inbox', 'Inbox', 'Follow up with account holders'],
          ]
            .map(
              ([href, symbol, title, description]) =>
                `<a href="#${href}"><span class="admin-tool-icon">${icon(symbol)}</span><span><strong>${title}</strong><small>${description}</small></span>${icon('chevron')}</a>`,
            )
            .join('')}</nav></section>
          <section class="panel admin-published"><div class="panel-heading"><div><h2>Published announcements</h2><p>${published.length} published · ${announcements.filter((a) => a.status === 'Draft').length} drafts</p></div><a class="icon-link" href="#announcements" aria-label="Manage all announcements">${icon('arrow')}</a></div>${
            published.length
              ? `<div class="announcement-previews">${published
                  .slice(0, 3)
                  .map(
                    (a) =>
                      `<button class="announcement-preview" data-action="read-announcement" data-id="${a.id}"><span class="announcement-category ${isEmergencyAdvisory(a) ? 'emergency-category' : ''}">${icon(isEmergencyAdvisory(a) ? 'alert' : 'megaphone')}${a.pinned ? 'Pinned · ' : ''}${escape(a.category)}</span><h3>${escape(a.title)}</h3><p>${escape(a.content.slice(0, 100))}${a.content.length > 100 ? '…' : ''}</p><span class="announcement-date">Published ${date(a.publishedAt)}</span></button>`,
                  )
                  .join('')}</div>`
              : empty(
                  'megaphone',
                  'No published announcements',
                  'Publish an announcement to keep the campus informed.',
                  link('Create announcement', '#announcements/new', 'secondary'),
                )
          }</section>
          <section class="panel admin-recent-activity"><div class="panel-heading"><h2>Recent activity</h2><a class="icon-link" href="#audit" aria-label="View all activity">${icon('arrow')}</a></div>${
            activity.length
              ? `<ol>${activity
                  .slice(0, 4)
                  .map(
                    (entry) =>
                      `<li><span class="recent-activity-icon">${icon(entry.resource?.type === 'incident' ? 'report' : entry.resource?.type === 'announcement' ? 'megaphone' : 'users')}</span><div><strong>${escape(AUDIT_ACTIONS[entry.action])}</strong>${adminActivityLink(entry)}<small>${entry.actor ? escape(entry.actor.name) + ' · ' : ''}${date(entry.createdAt, true)}</small></div></li>`,
                  )
                  .join('')}</ol>`
              : empty('clock', 'No activity yet', 'Saved administrative actions appear here.')
          }</section>
        ${adminCategorySummary(summary)}</aside></div>`;
    }

    async function dashboard() {
      if (role === 'admin') return adminDashboard();

      const announcements = await service.listAnnouncements({ role, publishedOnly: true });
      return [
        `<div class="student-home">`,
        `<section class="welcome-hero">`,
        `<div class="hero-content">`,
        `<span class="hero-label">${icon('shield')} CMUAlert � CITY OF MALABON UNIVERSITY</span>`,
        `<h2>Welcome to CMUAlert</h2>`,
        `<p>Your campus space to report a concern, follow updates, and stay connected with the university.</p>`,
        `</div>`,
        `<span class="hero-shield" aria-hidden="true">${icon('shield')}</span>`,
        `</section>`,
        `<nav class="home-shortcuts" aria-label="Quick actions">`,
        `<a href="#reports"><span>${icon('lock')}</span><strong>My Reports</strong></a>`,
        `<a href="#report/new"><span>${icon('megaphone')}</span><strong>Report</strong></a>`,
        `<a href="#inbox"><span>${icon('inbox')}</span><strong>My Inbox</strong></a>`,
        `</nav>`,
        `<section class="home-announcements">`,
        `<div class="section-heading"><h2><span>${icon('bell')}</span>Announcements${announcements.length ? `<span class="section-count">${announcements.length}</span>` : ''}</h2><a class="text-link" href="#announcements">View all ${icon('arrow')}</a></div>`,
        announcements.length
          ? announcements.slice(0, 3).map((announcement) => `
            <button class="home-announcement ${announcement.pinned ? 'is-pinned' : ''}" data-action="read-announcement" data-id="${announcement.id}">
              <span class="home-announcement-pin" aria-hidden="true">${announcement.pinned ? icon('pin') : ''}</span>
              <strong>${escape(announcement.title)}</strong>
              <span class="home-announcement-copy">${escape(announcement.content.slice(0, 180))}${announcement.content.length > 180 ? '�' : ''}</span>
              <time datetime="${announcement.publishedAt}">${date(announcement.publishedAt)}</time>
            </button>`).join('')
          : `<div class="home-announcements-empty"></div>`,
        `</section>`,
        `</div>`,
      ].join('');
    }
    function steps() {
      return `<ol class="wizard-steps">${[
        'Choose category',
        'Incident details',
        'Review report',
        'Confirmation',
      ]
        .map((s, i) =>
          [
            `<li class="${i < reportStep ? 'complete' : i === reportStep ? 'current' : ''}" ${i === reportStep ? 'aria-current="step"' : ''}>`,
            `<span>${i < reportStep ? icon('check') : i + 1}</span>`,
            `<div>`,
            `<small>STEP ${i + 1}</small>`,
            `<strong>${s}</strong>`,
            `</div>`,
            `</li>`,
          ].join(''),
        )
        .join('')}</ol>`;
    }
    function reportWizard() {
      reportDraft ??= newDraft(new URLSearchParams(location.hash.split('?')[1]).get('category'));
      if (!reportableCategoryById(reportDraft.category)) {
        reportDraft.category = '';
        reportStep = 0;
      }
      if (receipt) reportStep = 3;
      const d = reportDraft;
      let content = '';
      if (reportStep === 0)
        content = [
          `<form id="category-form">`,
          `<div class="form-panel-heading">`,
          `<h2>What kind of concern is it?</h2>`,
          `<p id="category-help">Choose one category. Select another card to change it, or clear your selection.</p>`,
          `</div>`,
          `<fieldset class="category-options" aria-describedby="category-help">`,
          `<legend class="sr-only">Incident category (required)</legend>${CATEGORIES.map((c) =>
            [
              `<label class="category-option">`,
              `<input type="radio" name="category" value="${c.id}" required ${d.category === c.id ? 'checked' : ''}>${categoryIcon(c.id)}<span>`,
              `<strong>${c.name}</strong>`,
              `<small>${c.description}</small>`,
              `</span>`,
              `<span class="radio-circle">`,
              `</span>`,
              `</label>`,
            ].join(''),
          ).join(
            '',
          )}</fieldset><div class="category-selection-toolbar"><p id="category-selection-note" role="status">${d.category ? 'Selected: ' + categoryLabel(d.category) : 'No category selected'}</p>${button('Clear selection', 'clear-category', 'text', `type="button"${d.category ? '' : ' disabled'}`)}</div>${callout('<strong>If someone is in immediate danger, act now.</strong><br>Follow CMU’s established emergency procedures. This portal does not replace urgent reporting.', 'warning')}<div class="wizard-footer">`,
          `<button class="btn btn-primary" type="submit">Continue ${icon('arrow')}</button>`,
          `</div>`,
          `</form>`,
        ].join('');
      if (reportStep === 1)
        content = [
          `<form id="report-form">`,
          `<div class="form-panel-heading">`,
          `<h2>Incident details</h2>`,
          `<p>Describe what you observed. Fields marked <span aria-hidden="true">*</span><span class="sr-only">with an asterisk</span> are required.</p>`,
          `</div>`,
          `<div class="selected-category">${categoryIcon(d.category)}<div>`,
          `<small>Selected category</small>`,
          `<strong>${categoryLabel(d.category)}</strong>`,
          `</div>${button('Change', 'report-category', 'text')}</div>${d.category === 'weapon' ? callout('<strong>Urgent weapon-related threat?</strong> Follow university emergency procedures immediately. Do not wait for a response through this website.', 'warning') : ''}<div class="form-error" tabindex="-1" role="alert" hidden>`,
          `</div>`,
          `
    <div class="field">`,
          `<label for="incident-title">Incident title <span>*</span>`,
          `</label>`,
          `<input id="incident-title" name="title" maxlength="120" required value="${escape(d.title)}" placeholder="Give your concern a short, clear title">`,
          `<small>Up to 120 characters.</small>`,
          `</div>`,
          `
    <div class="field">`,
          `<label for="incident-description">What happened? <span>*</span>`,
          `</label>`,
          `<textarea id="incident-description" name="description" rows="5" maxlength="5000" required placeholder="Describe what happened and any details that may help the university understand your concern.">${escape(d.description)}</textarea>`,
          `<small>Stick to what you observed. Avoid unnecessary personal information.</small>`,
          `</div>`,
          `
    <div class="field">`,
          `<label for="incident-location">Location / room <span class="optional">Optional</span>`,
          `</label>`,
          `<div class="input-with-icon">${icon('pin')}<input id="incident-location" name="location" maxlength="200" value="${escape(d.location)}" placeholder="Building, room, or area on campus">`,
          `</div>`,
          `</div>`,
          `
    <div class="form-grid">`,
          `<div class="field">`,
          `<label for="incident-date">Date of incident <span>*</span>`,
          `</label>`,
          `<input id="incident-date" name="incidentDate" type="date" min="2000-01-01" max="${localDate()}" value="${escape(d.incidentDate)}" required>`,
          `</div>`,
          `<div class="field">`,
          `<label for="incident-time">Time of incident <span>*</span>`,
          `</label>`,
          `<input id="incident-time" name="incidentTime" type="time" value="${escape(d.incidentTime)}" required>`,
          `</div>`,
          `</div>`,
          `
    <div class="field">`,
          `<label for="attachments">Supporting photos <span class="optional">Optional</span>`,
          `</label>`,
          `<label class="upload-zone" for="attachments">${icon('upload')}<strong>Choose photos</strong>`,
          `<span>Upload up to 3 photos · JPG/PNG · Up to 5 MB each</span>`,
          `<input id="attachments" type="file" multiple accept="image/jpeg,image/png">`,
          `</label>`,
          `<div id="selected-files">${selectedFiles()}</div>`,
          `</div>`,
          `
    <fieldset class="reporting-modes">`,
          `<legend>Reporting method <span class="optional">Required</span></legend>`,
          `<label class="mode-option">`,
          `<input type="radio" name="mode" value="identified" required ${d.mode === 'identified' ? 'checked' : ''}>`,
          `<span>${icon('user')}<strong>Identified report</strong>`,
          `<small>Your university account is linked to this report. Follow its status and updates in My Reports.</small>`,
          `</span>`,
          `</label>${
            categoryById(d.category)?.allowAnonymous
              ? [
                  `<label class="mode-option">`,
                  `<input type="radio" name="mode" value="anonymous" ${d.mode === 'anonymous' ? 'checked' : ''}>`,
                  `<span>${icon('eye')}<strong>Anonymous report</strong>`,
                  `<small>Your name is not attached to the report. Save its private tracking reference; anonymous reports do not appear in My Reports.</small>`,
                  `</span>`,
                  `</label>`,
                ].join('')
              : ''
          }</fieldset>`,
          `${categoryById(d.category)?.allowAnonymous ? '' : callout('Anonymous reporting is unavailable for this category. Submit an identified report instead.', 'info')}`,
          `<p class="privacy-note">${icon('lock')}<span>Only include details needed to explain your concern. For anonymous reports, avoid names or contact details that identify you.</span>`,
          `</p>`,
          `<div class="wizard-footer">${button(icon('back') + ' Back', 'report-back', 'secondary')}<button type="submit" class="btn btn-primary">Review report ${icon('arrow')}</button>`,
          `</div>`,
          `</form>`,
        ].join('');
      if (reportStep === 2)
        content = [
          `<form id="submit-report-form">`,
          `<div class="form-panel-heading">`,
          `<h2>Review your report</h2>`,
          `<p>Check the details below before sending your concern.</p>`,
          `</div>`,
          `<div class="form-error" tabindex="-1" role="alert" hidden>`,
          `</div>`,
          `<div class="review-title">${categoryIcon(d.category)}<div>`,
          `<span>${categoryLabel(d.category)}</span>`,
          `<h3>${escape(d.title)}</h3>`,
          `</div>`,
          `</div>`,
          `<dl class="detail-grid">`,
          `<div>`,
          `<dt>Location</dt>`,
          `<dd>${escape(d.location) || 'Not provided'}</dd>`,
          `</div>`,
          `<div>`,
          `<dt>Incident date & time</dt>`,
          `<dd>${date(`${d.incidentDate}T${d.incidentTime}`, true)}</dd>`,
          `</div>`,
          `<div>`,
          `<dt>Reporting mode</dt>`,
          `<dd>${d.mode === 'anonymous' ? 'Anonymous · tracking reference provided' : 'Identified · signed-in account'}</dd>`,
          `</div>`,
          `<div>`,
          `<dt>Attachments</dt>`,
          `<dd>${d.files.length ? d.files.map((f) => escape(f.name)).join('<br>') : 'None attached'}</dd>`,
          `</div>`,
          `</dl>`,
          `<div class="detail-section">`,
          `<h3>Description</h3>`,
          `<p class="preserve-lines">${escape(d.description)}</p>`,
          `</div>`,
          `<label class="checkbox-label">`,
          `<input type="checkbox" name="confirm" required>`,
          `<span>I have reviewed my report and am ready to submit it.</span>`,
          `</label>`,
          `<div class="wizard-footer">${button(icon('edit') + ' Edit details', 'report-back', 'secondary')}<button type="submit" class="btn btn-primary">${icon('check')} Submit report</button>`,
          `</div>`,
          `</form>`,
        ].join('');
      if (reportStep === 3 && receipt)
        content = [
          `<div class="submission-confirmation">`,
          `<span class="success-icon">${icon('check')}</span>`,
          `<h2>Report submitted.</h2>`,
          `<p class="receipt-next-step">${receipt.mode === 'anonymous' ? 'Save your report reference and private tracking reference below. Use Track Anonymous Report to check its status and authorized updates.' : 'Your report is linked to your account. Open My Reports to check its status and read university updates.'}</p>`,
          `<div class="receipt-reference">`,
          `<small>REPORT REFERENCE</small>`,
          `<strong>${escape(receipt.reference)}</strong>${badge(receipt.status)}</div>`,
          `<dl class="receipt-details">`,
          `<div>`,
          `<dt>Category</dt>`,
          `<dd>${categoryLabel(receipt.category)}</dd>`,
          `</div>`,
          `<div>`,
          `<dt>Submitted</dt>`,
          `<dd>${date(receipt.createdAt, true)}</dd>`,
          `</div>`,
          `</dl>${
            receipt.mode === 'anonymous'
              ? [
                  `<div class="tracking-receipt">`,
                  `<strong>Anonymous tracking reference</strong>`,
                  `<p>Keep this reference private. You need it to track this anonymous report; it will not appear in My Reports.</p>`,
                  `<div>`,
                  `<code id="tracking-reference">${escape(receipt.trackingReference)}</code>${button(icon('copy'), 'copy-tracking', 'secondary', 'aria-label="Copy tracking reference"')}</div>`,
                  `</div>`,
                ].join('')
              : ''
          }<div class="confirmation-actions">${link(receipt.mode === 'anonymous' ? 'Track this report ' + icon('arrow') : (role === 'admin' ? 'View report ' : 'View my report ') + icon('arrow'), receipt.mode === 'anonymous' ? '#track' : `#reports/${receipt.id}`)}${link('Back to overview', '#dashboard', 'secondary')}</div>`,
          `<div class="receipt-download">${button(icon('download') + ' Download receipt', 'download-receipt', 'secondary')}</div>`,
          `</div>`,
        ].join('');
      return [
        `${heading('', 'Report an incident', '')}<div class="wizard-layout">`,
        `<div>${steps()}<section class="panel wizard-panel">${content}</section>`,
        `</div>`,
        `</div>`,
      ].join('');
    }

    function selectedFiles() {
      for (const [file, url] of filePreviewURLs) {
        if (!reportDraft.files.includes(file)) {
          URL.revokeObjectURL(url);
          filePreviewURLs.delete(file);
        }
      }
      return (
        `<p class="photo-count" role="status">${reportDraft.files.length} of 3 photos added</p>` +
        reportDraft.files
          .map((file, i) =>
            [
              `<div class="selected-file">${file.type.startsWith('image/') ? `<img class="file-thumbnail" src="${previewURL(file)}" alt="Preview of ${escape(file.name)}">` : icon('report')}<span>`,
              `<strong>${escape(file.name)}</strong>`,
              `<small>${(file.size / 1024).toFixed(0)} KB</small>`,
              `</span>`,
              `<button type="button" class="icon-button" data-action="remove-file" data-index="${i}" aria-label="Remove ${escape(file.name)}">${icon('close')}</button>`,
              `</div>`,
            ].join(''),
          )
          .join('')
      );
    }
    function previewURL(file) {
      if (!filePreviewURLs.has(file)) filePreviewURLs.set(file, URL.createObjectURL(file));
      return filePreviewURLs.get(file);
    }
    async function reportList() {
      if (role === 'admin') return adminReportsPage();
      if (!(await service.getReportsAccess()).unlocked) return reportsUnlockPage();
      const records = await service.listReports({ role, ...filters });
      const all = await service.listReports({ role });

      const availableCategories = categoriesForRecords(all);
      return [
        `${heading('STAY IN THE LOOP', 'My reports', '', `${preferences.hasReportsPasscode ? button(icon('lock') + ' Lock reports', 'lock-reports', 'secondary') : ''}${link(icon('plus') + ' Report an incident', '#report/new')}`)}
    <section class="panel reports-panel">`,
        `<div class="list-toolbar">`,
        `<div>`,
        `<h2>Your submissions <span class="count-pill">${all.length}</span>`,
        `</h2>`,
        `</div><a class="text-link" href="#track">Track an anonymous report ${icon('arrow')}</a></div>`,
        `
    <form id="report-filters" class="filters"><div class="form-error" tabindex="-1" role="alert" hidden></div>`,
        `<div class="input-with-icon search-field">${icon('search')}<label class="sr-only" for="report-search">Search reports</label>`,
        `<input id="report-search" name="query" placeholder="Search by reference, title, or location…" value="${escape(filters.query)}">`,
        `</div>`,
        `<label class="sr-only" for="report-category-filter">Filter by category</label>`,
        `<select id="report-category-filter" name="category">`,
        `<option value="">All categories</option>${availableCategories.map((c) => `<option value="${c.id}"${selected(filters.category, c.id)}>${c.name}</option>`).join('')}</select>`,
        `<label class="sr-only" for="report-status-filter">Filter by status</label>`,
        `<select id="report-status-filter" name="status">`,
        `<option value="">All statuses</option>${STATUSES.map((status) => `<option${selected(filters.status, status)}>${status}</option>`).join('')}</select>`,
        `<button type="submit" class="btn btn-secondary">Search</button>${hasReportFilters() ? button('Clear', 'clear-report-filters', 'text') : ''}`,
        `<div class="report-filter-options">`,
        `<div class="field"><label for="report-from-date">Start Date</label><input id="report-from-date" name="fromDate" type="date" value="${escape(filters.fromDate)}"></div>`,
        `<div class="field"><label for="report-to-date">End Date</label><input id="report-to-date" name="toDate" type="date" value="${escape(filters.toDate)}"></div>`,
        `<div class="field"><label for="report-sort">Report order</label><select id="report-sort" name="sort"><option value="submitted"${selected(filters.sort, 'submitted')}>Newest submissions</option><option value="oldest"${selected(filters.sort, 'oldest')}>Oldest submissions</option><option value="updated"${selected(filters.sort, 'updated')}>Recently updated</option></select></div>`,
        `</div></form>
    ${
      records.length
        ? [
            `<div class="table-scroll">`,
            `<table class="report-table" role="table">`,
            `<caption class="sr-only">Your identified incident reports</caption>`,
            `<thead role="rowgroup">`,
            `<tr role="row">`,
            `<th scope="col">Report</th>`,
            `<th scope="col">Category</th>`,
            `<th scope="col">Status</th><th scope="col">Submitted / updated</th>`,
            `<th scope="col">`,
            `<span class="sr-only">Action</span>`,
            `</th>`,
            `</tr>`,
            `</thead>`,
            `<tbody role="rowgroup">${records
              .map((r) =>
                [
                  `<tr role="row">`,
                  `
      <td role="cell" class="report-main-cell" data-label="Report">`,
                  `<a class="report-title" href="#reports/${r.id}">${escape(r.title)}</a>`,
                  `<span class="table-subtext mono">${escape(r.reference)}</span>`,
                  `</td>`,
                  `
      <td role="cell" data-label="Category">`,
                  `<span class="table-category">`,
                  `<span class="category-dot ${categoryById(r.category).color}">`,
                  `</span>${escape(categoryById(r.category).short)}</span>`,
                  `</td>`,
                  `
      <td role="cell" data-label="Status">${badge(r.status)}</td>
      
      <td role="cell" class="report-dates-cell" data-label="Dates">`,
                  `<span>Submitted ${date(r.createdAt)}</span>`,
                  `<span class="table-subtext">Updated ${date(r.updatedAt)}</span>`,
                  `</td>`,
                  `
      <td role="cell" class="report-action-cell">`,
                  `<a class="table-action" href="#reports/${r.id}" aria-label="View details for report ${escape(r.reference)}">View details ${icon('chevron')}</a>`,
                  `</td>`,
                  `
    </tr>`,
                ].join(''),
              )
              .join('')}</tbody>`,
            `</table>`,
            `</div>`,
            `<div class="table-footer">Showing ${records.length} of ${all.length} report${all.length === 1 ? '' : 's'} <span>${filters.sort === 'oldest' ? 'Oldest submissions first' : filters.sort === 'updated' ? 'Recently updated first' : 'Latest submissions first'}</span>`,
            `</div>`,
          ].join('')
        : empty(
            all.length ? 'search' : 'report',
            all.length ? 'No matching reports' : 'No reports yet',
            all.length ? 'Try changing or clearing the filters.' : '',
            all.length
              ? button('Clear filters', 'clear-report-filters', 'secondary')
              : link(icon('plus') + ' Report an incident', '#report/new'),
          )
    }</section>`,
      ].join('');
    }

    function reportTimeline(report) {
      return `<ol class="timeline">${[...report.history]
        .reverse()
        .map((entry, i) =>
          [
            `<li class="${i === 0 ? 'latest' : ''}">`,
            `<span class="timeline-marker">${icon(i === 0 ? 'check' : 'clock')}</span>`,
            `<div>`,
            `<strong>${escape(entry.status)}</strong>`,
            `<time>${date(entry.createdAt, true)}</time>`,
            `<p>${escape(entry.message)}</p>`,
            `</div>`,
            `</li>`,
          ].join(''),
        )
        .join('')}</ol>`;
    }
    function publicUpdates(report) {
      return report.reporterUpdates.length
        ? `<div class="updates-list">${[...report.reporterUpdates]
            .reverse()
            .map((u) =>
              [
                `<article>`,
                `<span class="update-avatar">${icon('shield')}</span>`,
                `<div>`,
                `<strong>University update</strong>`,
                `<time>${date(u.createdAt, true)}</time>`,
                `<p class="preserve-lines">${escape(u.text)}</p>`,
                `</div>`,
                `</article>`,
              ].join(''),
            )
            .join('')}</div>`
        : [`<div class="quiet-empty">${icon('mail')}<p>No updates yet.</p>`, `</div>`].join('');
    }
    async function incidentDetail(reportId) {
      if (!(await service.getReportsAccess()).unlocked) return reportsUnlockPage();
      const r = await service.getIncident(reportId, { role });
      currentIncident = r;
      const activity = (await service.listActivity()).filter((a) => a.href === `#reports/${r.id}`);
      await service.markActivityRead(activity.map((a) => a.id));
      const admin = role === 'admin';
      return [
        `<a class="back-link" href="#reports">${icon('back')} Back to ${admin ? 'incident reports' : 'my reports'}</a>${heading(escape(r.reference), escape(r.title), `Submitted ${date(r.createdAt, true)} · Updated ${date(r.updatedAt, true)}`, badge(r.status))}<div class="report-case-summary"><span class="queue-reference">${escape(r.reference)}</span>${admin ? reportSafetyMark(r) : ''}</div>${admin && r.category === 'weapon' && !['Resolved', 'Closed'].includes(r.status) ? callout('Weapon-related concern. Follow the university’s established emergency procedures for immediate danger; the recorded status does not verify a threat.', 'warning') : ''}<div class="detail-layout">`,
        `<div class="detail-main">`,
        `<section class="panel detail-panel">`,
        `<div class="panel-heading">`,
        `<h2>Incident information</h2>`,
        `<span class="mode-text">${icon(r.mode === 'anonymous' ? 'eye' : 'user')}${r.mode === 'anonymous' ? 'Anonymous report' : 'Identified report'}</span>`,
        `</div>`,
        `<dl class="detail-grid">`,
        `<div>`,
        `<dt>Category</dt>`,
        `<dd>${categoryLabel(r.category)}</dd>`,
        `</div>`,
        `<div>`,
        `<dt>Location</dt>`,
        `<dd>${escape(r.location) || 'Not provided'}</dd>`,
        `</div>`,
        `<div>`,
        `<dt>Incident date & time</dt>`,
        `<dd>${date(`${r.incidentDate}T${r.incidentTime}`, true)}</dd>`,
        `</div>`,
        `<div>`,
        `<dt>Reporter</dt>`,
        `<dd>${admin ? (r.mode === 'anonymous' ? 'Not collected · anonymous report' : escape(r.reporterName || 'University account') + (r.reporterRole ? '<small class="table-subtext">' + roleLabel(r.reporterRole) + '</small>' : '')) : 'Your signed-in account'}</dd>`,
        `</div>`,
        `</dl>`,
        `<div class="detail-section">`,
        `<h3>Description</h3>`,
        `<p class="preserve-lines">${escape(r.description)}</p>`,
        `</div>`,
        `<div class="detail-section">`,
        `<h3>Attachments <span class="count-pill">${r.attachments.length}</span>`,
        `</h3>${
          r.attachments.length
            ? `<div class="attachment-list">${r.attachments
                .map((a) =>
                  [
                    `<button data-action="view-attachment" data-report="${r.id}" data-id="${escape(a.id)}">${icon('paperclip')}<span>`,
                    `<strong>${escape(a.name)}</strong>`,
                    `<small>${(a.size / 1024).toFixed(0)} KB</small>`,
                    `</span>${icon('eye')}</button>`,
                  ].join(''),
                )
                .join('')}</div>`
            : '<p class="muted">No attachments were added.</p>'
        }</div>`,
        `</section>`,
        `<section class="panel detail-panel">`,
        `<div class="panel-heading">`,
        `<div>`,
        `<h2>Updates for the reporter</h2>`,
        `</div>${icon('mail')}</div>${publicUpdates(r)}</section>${
          r.resolution
            ? [
                `<section class="panel detail-panel resolution-panel">`,
                `<div class="panel-heading">`,
                `<h2>${icon('check-circle')} Resolution documented</h2>`,
                `<span>${date(r.resolution.createdAt)}</span>`,
                `</div>`,
                `<p class="preserve-lines">${escape(r.resolution.text)}</p>`,
                `</section>`,
              ].join('')
            : ''
        }${admin ? adminReviewForm(r) : ''}${
          admin
            ? [
                `<section class="panel detail-panel internal-panel">`,
                `<div class="panel-heading">`,
                `<div>`,
                `<h2>${icon('lock')} Internal workspace</h2>`,
                `<p>Visible to administrators only.</p>`,
                `</div>`,
                `</div>`,
                `<h3>Actions taken</h3>${internalEntries(r.actions, 'No actions recorded yet.')}<h3>Internal notes</h3>${internalEntries(r.internalNotes, 'No internal notes recorded yet.')}</section>`,
              ].join('')
            : ''
        }</div>`,
        `<aside>`,
        `<section class="panel timeline-panel">`,
        `<div class="panel-heading">`,
        `<div>`,
        `<h2>Status history</h2>`,
        `</div>`,
        `</div>${reportTimeline(r)}</section>`,
        `</aside>`,
        `</div>`,
      ].join('');
    }
    function internalEntries(entries, message) {
      return entries.length
        ? `<div class="internal-entries">${[...entries]
            .reverse()
            .map((e) =>
              [
                `<article>`,
                `<span>${escape(e.actor)} · ${date(e.createdAt, true)}</span>`,
                `<p class="preserve-lines">${escape(e.text)}</p>`,
                `</article>`,
              ].join(''),
            )
            .join('')}</div>`
        : `<p class="muted small">${message}</p>`;
    }
    function adminReviewForm(r) {
      return [
        `<section class="panel detail-panel">`,
        `<div class="panel-heading">`,
        `<div>`,
        `<h2>Record an update</h2>`,
        `</div>${icon('edit')}</div>`,
        `<p class="workflow-note">Status updates document reported actions; they do not verify the incident.</p>`,
        `<form id="update-incident-form" data-id="${r.id}" data-version="${r.version}">`,
        `<div class="form-error" tabindex="-1" role="alert" hidden>`,
        `</div>`,
        `<div class="field">`,
        `<label for="next-status">Report status</label>`,
        `<select id="next-status" name="status">${[r.status, ...TRANSITIONS[r.status]].map((s) => `<option${selected(r.status, s)}>${s}</option>`).join('')}</select>`,
        `</div>`,
        `<div class="field">`,
        `<label for="public-update">Reporter-visible update <span class="visibility-tag">${icon('eye')} Shared with reporter</span>`,
        `</label>`,
        `<textarea id="public-update" name="publicUpdate" maxlength="5000" rows="3" placeholder="Explain the progress that can be shared with the reporter.">`,
        `</textarea>`,
        `<small>Required when changing the status. Do not include confidential notes.</small>`,
        `</div>`,
        `<div class="field">`,
        `<label for="action-taken">Action taken <span class="visibility-tag internal">${icon('lock')} Administrator only</span>`,
        `</label>`,
        `<textarea id="action-taken" name="action" maxlength="5000" rows="2" placeholder="Describe the action taken for this report.">`,
        `</textarea>`,
        `</div>`,
        `<div class="field">`,
        `<label for="internal-note">Internal note <span class="visibility-tag internal">${icon('lock')} Administrator only</span>`,
        `</label>`,
        `<textarea id="internal-note" name="internalNote" maxlength="5000" rows="2" placeholder="Information for the administrator workspace only.">`,
        `</textarea>`,
        `</div>`,
        `<div class="field" id="resolution-field" ${r.status === 'Resolved' ? '' : 'hidden'}>`,
        `<label for="resolution-text">Resolution details <span>*</span>`,
        `</label>`,
        `<textarea id="resolution-text" name="resolution" maxlength="5000" rows="3" placeholder="Describe the documented resolution.">`,
        `</textarea>`,
        `<small>Visible to the reporter after saving.</small>`,
        `</div>`,
        `<div class="form-actions">`,
        `<button type="submit" class="btn btn-primary">${icon('check')} Save update</button>`,
        `</div>`,
        `</form>`,
        `</section>`,
      ].join('');
    }

    function trackingEmptyState() {
      const notFound = trackingOutcome === 'not_found';
      const invalid = trackingOutcome === 'validation';
      const failed = trackingOutcome && !notFound && !invalid;
      return `<section class="panel tracking-placeholder"><div class="tracking-empty-content">${icon(notFound ? 'search' : invalid || failed ? 'info' : 'shield')}<div><h2>${notFound ? 'Report not found' : invalid ? 'Check your tracking reference' : failed ? 'Tracking unavailable' : 'Your report updates'}</h2><p>${notFound ? 'Check the full reference on your receipt, then try again.' : invalid ? 'Use the complete reference beginning with TRK-.' : failed ? 'Please try again.' : 'Enter your tracking reference to see the current status and authorized updates.'}</p></div></div></section>`;
    }

    function trackingPage() {
      return [
        `${heading('', 'Track an anonymous report', '')}<div class="tracking-layout">`,
        `<section class="panel tracking-search">`,
        `<div class="tracking-symbol">${icon('search')}</div>`,
        `<h2>Find your report</h2>`,
        `<p id="tracking-reference-help">Enter the full private TRK- reference from your submission receipt.</p>`,
        `<form id="tracking-form">`,
        `<div class="form-error" tabindex="-1" role="alert" hidden>`,
        `</div>`,
        `<div class="field">`,
        `<label for="tracking-input">Anonymous tracking reference</label>`,
        `<input id="tracking-input" name="reference" class="mono" placeholder="TRK-…" value="${escape(trackingValue)}" required maxlength="100" autocomplete="off" spellcheck="false" aria-describedby="tracking-reference-help">`,
        `</div>`,
        `<button class="btn btn-primary" type="submit">${icon('search')} Track report</button>`,
        trackingValue || tracked || trackingOutcome
          ? button('Clear result', 'clear-tracking', 'secondary', 'type="button"')
          : '',
        `</form>`,
        `<div class="tracking-privacy">${icon('lock')}<p>Anyone with this reference can view the permitted updates. Keep it private.</p>`,
        `</div>`,
        `</section>`,
        `<div id="tracking-results">${
          tracked
            ? [
                `<section class="panel tracked-report">`,
                `<div class="panel-heading">`,
                `<div>`,
                `<p class="eyebrow" role="status">REPORT FOUND</p>`,
                `<h2 class="mono">${escape(tracked.reference)}</h2>`,
                `</div>${badge(tracked.status)}</div>`,
                `<dl class="detail-grid">`,
                `<div>`,
                `<dt>Category</dt>`,
                `<dd>${categoryLabel(tracked.category)}</dd>`,
                `</div>`,
                `<div>`,
                `<dt>Submitted</dt>`,
                `<dd>${date(tracked.createdAt, true)}</dd>`,
                `</div>`,
                `<div>`,
                `<dt>Last updated</dt>`,
                `<dd>${date(tracked.updatedAt, true)}</dd>`,
                `</div>`,
                `</dl>`,
                `<div class="detail-section">`,
                `<h3>Status history</h3>${reportTimeline(tracked)}</div>`,
                `<div class="detail-section">`,
                `<h3>Updates for you</h3>${publicUpdates(tracked)}</div>${
                  tracked.resolution
                    ? [
                        `<div class="detail-section">`,
                        `<h3>Resolution</h3>`,
                        `<p class="preserve-lines">${escape(tracked.resolution.text)}</p>`,
                        `</div>`,
                      ].join('')
                    : ''
                }</section>`,
              ].join('')
            : trackingEmptyState()
        }</div>`,
        `</div>`,
      ].join('');
    }

    async function announcementsPage() {
      const admin = role === 'admin';
      const records = await service.listAnnouncements({ role, ...announcementFilters });
      const all = await service.listAnnouncements({ role });
      return [
        `${heading(admin ? 'KEEP YOUR COMMUNITY INFORMED' : 'FROM YOUR UNIVERSITY', 'Announcements', '', admin ? button(icon('plus') + ' New announcement', 'new-announcement') : '')}<section class="panel announcement-filter-panel">`,
        `<form id="announcement-filters" class="filters">`,
        `<div class="input-with-icon search-field">${icon('search')}<label class="sr-only" for="announcement-search">Search announcements</label>`,
        `<input id="announcement-search" name="query" value="${escape(announcementFilters.query)}" placeholder="Search announcements…">`,
        `</div>`,
        `<label class="sr-only" for="announcement-category-filter">Announcement category</label>`,
        `<select name="category" id="announcement-category-filter">`,
        `<option value="">All categories</option>${ANNOUNCEMENT_CATEGORIES.map((c) => `<option${selected(announcementFilters.category, c)}>${c}</option>`).join('')}</select>${
          admin
            ? [
                `<label class="sr-only" for="announcement-status-filter">Publication status</label>`,
                `<select name="status" id="announcement-status-filter">`,
                `<option value="">All statuses</option>${['Draft', 'Published', 'Archived'].map((s) => `<option${selected(announcementFilters.status, s)}>${s}</option>`).join('')}</select>`,
              ].join('')
            : ''
        }<button class="btn btn-secondary" type="submit">Search</button>${Object.values(announcementFilters).some(Boolean) ? button('Clear', 'clear-announcement-filters', 'text') : ''}</form>`,
        `</section>${
          records.length
            ? [
                `<p class="results-count">${records.length} announcement${records.length === 1 ? '' : 's'}</p>`,
                `<div class="announcement-grid">${records
                  .map((a) =>
                    [
                      `<article class="panel announcement-card ${isEmergencyAdvisory(a) ? 'emergency-card' : ''}">`,
                      `<div class="announcement-card-top">`,
                      `<span class="announcement-category ${isEmergencyAdvisory(a) ? 'emergency-category' : ''}">${isEmergencyAdvisory(a) ? icon('alert') : ''}${a.pinned ? 'Pinned · ' : ''}${escape(a.category)}</span>${admin ? badge(a.status) : icon('megaphone')}</div>`,
                      `<h2>${escape(a.title)}</h2>`,
                      `<p class="announcement-excerpt preserve-lines">${escape(a.content.slice(0, 220))}${a.content.length > 220 ? '…' : ''}</p>`,
                      `<div class="announcement-meta">`,
                      `<span>${icon('calendar')}<time datetime="${a.status === 'Published' ? a.publishedAt : a.updatedAt}">${a.status === 'Published' ? 'Published' : 'Updated'} ${date(a.status === 'Published' ? a.publishedAt : a.updatedAt)}</time></span>`,
                      `<span>${icon('users')}${escape(a.audience)}</span>`,
                      `</div>`,
                      `<div class="announcement-card-footer">${button('Read announcement ' + icon('arrow'), 'read-announcement', 'text', `data-id="${a.id}"`)}${admin ? `<div class="announcement-admin-actions">${button(icon('edit'), 'edit-announcement', 'secondary', `data-id="${a.id}" aria-label="Edit ${escape(a.title)}"`)}${a.status !== 'Archived' ? button(icon('archive'), 'archive-announcement', 'secondary', `data-id="${a.id}" data-version="${a.version}" aria-label="Archive ${escape(a.title)}"`) : ''}</div>` : ''}</div>`,
                      `</article>`,
                    ].join(''),
                  )
                  .join('')}</div>`,
              ].join('')
            : `<section class="panel large-empty">${empty(Object.values(announcementFilters).some(Boolean) ? 'search' : 'megaphone', all.length ? 'No matching announcements' : 'No announcements yet', all.length ? 'Try changing or clearing the filters.' : '', all.length ? button('Clear filters', 'clear-announcement-filters', 'secondary') : admin ? button(icon('plus') + ' Create an announcement', 'new-announcement') : '')}</section>`
        }`,
      ].join('');
    }
    function announcementEditor(record = announcementDraft) {
      const d = record || {
        title: '',
        content: '',
        category: 'Safety advisory',
        audience: 'University community',
      };
      return [
        `<a class="back-link" href="#announcements">${icon('back')} Back to announcements</a>${heading('SECURITY OFFICE COMMUNICATIONS', d.id ? 'Edit announcement' : 'New announcement', '')}<div class="editor-layout">`,
        `<section class="panel editor-panel">`,
        `<form id="announcement-form">`,
        `<div class="form-error" tabindex="-1" role="alert" hidden>`,
        `</div>`,
        `<div class="field">`,
        `<label for="announcement-title">Announcement title <span>*</span>`,
        `</label>`,
        `<input id="announcement-title" name="title" value="${escape(d.title)}" maxlength="160" placeholder="A clear headline for your update" required>`,
        `</div>`,
        `<div class="form-grid">`,
        `<div class="field">`,
        `<label for="announcement-category">Category <span>*</span>`,
        `</label>`,
        `<select name="category" id="announcement-category">${ANNOUNCEMENT_CATEGORIES.map((c) => `<option${selected(d.category, c)}>${c}</option>`).join('')}</select>`,
        `</div>`,
        `<div class="field">`,
        `<label for="announcement-audience">Intended audience <span>*</span>`,
        `</label>`,
        `<select name="audience" id="announcement-audience">${AUDIENCES.map((a) => `<option${selected(d.audience, a)}>${a}</option>`).join('')}</select>`,
        `</div>`,
        `</div>`,
        `<div class="field">`,
        `<label for="announcement-content">Announcement content <span>*</span>`,
        `</label>`,
        `<textarea id="announcement-content" name="content" rows="12" maxlength="10000" placeholder="Write the complete announcement here…" required>${escape(d.content)}</textarea>`,
        `<small>Keep confidential report details out of announcements.</small>`,
        `</div><label class="checkbox-label"><input type="checkbox" name="pinned" ${d.pinned ? 'checked' : ''}><span>Pin this announcement above other updates</span></label>${
          d.id
            ? [
                `<div class="editor-timestamps">`,
                `<span>Created ${date(d.createdAt, true)}</span>`,
                `<span>Updated ${date(d.updatedAt, true)}</span>${d.publishedAt ? `<span>Published ${date(d.publishedAt, true)}</span>` : ''}</div>`,
              ].join('')
            : ''
        }<div class="form-actions">${button(icon('eye') + ' Preview', 'preview-announcement', 'text')}<div>`,
        `<button type="submit" class="btn btn-secondary" name="intent" value="Draft">Save draft</button>`,
        `<button type="submit" class="btn btn-primary" name="intent" value="Published">${icon('megaphone')} ${d.status === 'Published' ? 'Update publication' : 'Publish'}</button>`,
        `</div>`,
        `</div>`,
        `</form>`,
        `</section>`,
        `</div>`,
      ].join('');
    }
    function announcementBody(a, preview = false) {
      return [
        `<div class="announcement-read">`,
        `<div class="announcement-read-meta">`,
        `<span class="announcement-category ${isEmergencyAdvisory(a) ? 'emergency-category' : ''}">${escape(a.category)}</span>`,
        `<span>${escape(a.audience)}</span>`,
        `</div>`,
        `<h3>${escape(a.title)}</h3>`,
        `<p class="read-publication-date">${preview ? 'Preview · not saved or published' : a.publishedAt ? 'Published ' + date(a.publishedAt, true) : 'Draft · updated ' + date(a.updatedAt, true)}</p>`,
        `<div class="preserve-lines read-content">${escape(a.content)}</div>`,
        `</div>`,
      ].join('');
    }

    // Administrator account management and audit screens.
    const accountStatus = (status) =>
      `<span class="account-status ${status === 'active' ? 'is-active' : 'is-disabled'}">${status === 'active' ? 'Active' : 'Disabled'}</span>`;
    async function accountsPage() {
      const all = await service.listAccounts();
      const records = await service.listAccounts(accountFilters);
      return [
        `${heading('', 'User Management', 'Manage access for students, faculty, and staff.', link(icon('plus') + ' Create account', '#accounts/new'))}
    <div class="stats-grid account-stats">${[
      ['Student accounts', all.filter((u) => u.role === 'student').length],
      ['Faculty / staff accounts', all.filter((u) => u.role === 'faculty').length],
      ['Active accounts', all.filter((u) => u.status === 'active').length],
      ['Disabled accounts', all.filter((u) => u.status === 'disabled').length],
    ]
      .map(([label, count]) =>
        [
          `<div class="panel account-stat">`,
          `<span>${label}</span>`,
          `<strong>${count}</strong>`,
          `</div>`,
        ].join(''),
      )
      .join('')}</div>`,
        `
    <section class="panel account-directory">`,
        `<h2 class="sr-only">Account directory</h2>`,
        `<form class="filters" id="account-filters">`,
        `<div class="search-field">`,
        `<label class="sr-only" for="account-search">Search accounts</label>`,
        `<div class="input-with-icon">${icon('search')}<input id="account-search" name="query" type="search" value="${escape(accountFilters.query)}" placeholder="Search by name or username" maxlength="100">`,
        `</div>`,
        `</div>`,
        `<label class="sr-only" for="account-role-filter">Filter by role</label>`,
        `<select id="account-role-filter" name="role">`,
        `<option value="">All roles</option>${['student', 'faculty', 'admin'].map((value) => `<option value="${value}"${selected(accountFilters.role, value)}>${roleLabel(value)}</option>`).join('')}</select>`,
        `<label class="sr-only" for="account-status-filter">Filter by account access</label>`,
        `<select id="account-status-filter" name="status">`,
        `<option value="">All access</option>`,
        `<option value="active"${selected(accountFilters.status, 'active')}>Active</option>`,
        `<option value="disabled"${selected(accountFilters.status, 'disabled')}>Disabled</option>`,
        `</select>`,
        `<button class="btn btn-secondary" type="submit">Search</button>${button('Clear', 'clear-account-filters', 'text')}</form>
    ${
      records.length
        ? [
            `<div class="account-grid">${records
              .map((u) =>
                [
                  `<article class="account-card" data-account-id="${u.id}">`,
                  `<div class="account-card-heading">`,
                  `<span class="avatar">${icon(u.role === 'admin' ? 'shield' : 'user')}</span>${accountStatus(u.status)}</div>`,
                  `<h3>${escape(u.name)}</h3>`,
                  `<p class="account-username">${escape(u.username)}</p>`,
                  `<p class="account-role">${roleLabel(u.role)}</p>${u.mustChangePassword ? '<p class="account-password-notice">Password change required</p>' : ''}<div class="account-card-footer">`,
                  `<span>Created ${date(u.createdAt)}</span>${u.role === 'admin' ? (u.id === currentUser.id ? link('Your profile', '#profile', 'secondary') : '<span>Administrator</span>') : link('Manage account ' + icon('arrow'), '#accounts/edit/' + u.id, 'secondary')}</div>`,
                  `</article>`,
                ].join(''),
              )
              .join('')}</div>`,
            `<div class="table-footer">`,
            `<span>${records.length} account${records.length === 1 ? '' : 's'}</span>`,
            `<span>Disabled accounts retain their saved reports.</span>`,
            `</div>`,
          ].join('')
        : empty(
            'users',
            'No matching accounts',
            'Try a different search or clear the filters.',
            button('Clear filters', 'clear-account-filters', 'secondary'),
          )
    }</section>`,
      ].join('');
    }
    function accountEditor(user = null) {
      if (user?.role === 'admin')
        return (
          heading('', 'Administrator account', '') +
          empty(
            'shield',
            'Manage your own administrator profile',
            'Use your profile to update your name or password.',
            link('Open profile', '#profile/details'),
          )
        );
      const credentials = (prefix) =>
        [
          `<div class="form-grid">`,
          `<div class="field">`,
          `<label for="${prefix}-password">Temporary password</label>`,
          `<input id="${prefix}-password" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password">`,
          `</div>`,
          `<div class="field">`,
          `<label for="${prefix}-confirm">Confirm temporary password</label>`,
          `<input id="${prefix}-confirm" name="confirmPassword" type="password" required minlength="8" maxlength="128" autocomplete="new-password">`,
          `</div>`,
          `</div>`,
          `<p class="account-form-help">Use 8–128 characters and share the temporary password privately. The account holder must replace it after signing in.</p>`,
        ].join('');
      const verification = (prefix) =>
        [
          `<div class="field">`,
          `<label for="${prefix}-admin-password">Your administrator password</label>`,
          `<input id="${prefix}-admin-password" name="currentPassword" type="password" required maxlength="128" autocomplete="current-password">`,
          `</div>`,
        ].join('');
      const reason = (prefix) =>
        [
          `<div class="field">`,
          `<label for="${prefix}-reason">Reason for ${prefix === 'reset' ? 'password reset' : 'change'}</label>`,
          `<textarea id="${prefix}-reason" name="reason" rows="3" required maxlength="500">`,
          `</textarea>`,
          `</div>`,
        ].join('');
      return [
        `${heading('', user ? 'Manage account' : 'Create account', user ? 'Changes to access, username, or role end the account’s active sessions.' : 'Create a student or faculty / staff account with a temporary password.', link(icon('back') + ' Back to accounts', '#accounts', 'secondary'))}
    <div class="account-editor-layout">`,
        `<div>`,
        `<section class="panel settings-panel">`,
        `<div class="panel-heading">`,
        `<h2>${user ? 'Account details' : 'New account details'}</h2>${user ? accountStatus(user.status) : icon('users')}</div>`,
        `<form id="manage-account-form" data-id="${user?.id || ''}" data-version="${user?.version || ''}">`,
        `<div class="form-error" tabindex="-1" role="alert" hidden>`,
        `</div>`,
        `
      <div class="form-grid">`,
        `<div class="field">`,
        `<label for="managed-name">Full name</label>`,
        `<input id="managed-name" name="name" required maxlength="80" autocomplete="off" value="${escape(user?.name)}">`,
        `</div>`,
        `<div class="field">`,
        `<label for="managed-username">CMU ID or username</label>`,
        `<input id="managed-username" name="username" required minlength="3" maxlength="50" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}" autocomplete="off" value="${escape(user?.username)}">`,
        `</div>`,
        `</div>`,
        `
      <div class="form-grid">`,
        `<div class="field">`,
        `<label for="managed-role">University role</label>`,
        `<select id="managed-role" name="role" required>${['student', 'faculty'].map((value) => `<option value="${value}"${selected(user?.role || 'student', value)}>${roleLabel(value)}</option>`).join('')}</select>`,
        `</div>${
          user
            ? [
                `<div class="field">`,
                `<label for="managed-status">Account access</label>`,
                `<select id="managed-status" name="status">`,
                `<option value="active"${selected(user.status, 'active')}>Active</option>`,
                `<option value="disabled"${selected(user.status, 'disabled')}>Disabled</option>`,
                `</select>`,
                `</div>`,
              ].join('')
            : ''
        }</div>
      ${user ? reason('managed') : credentials('managed')}${verification('managed')}<div class="form-actions">`,
        `<button type="submit" class="btn btn-primary">${user ? 'Save account changes' : 'Create account'}</button>`,
        `</div>`,
        `</form>`,
        `</section>
      ${
        user
          ? [
              `<section class="panel settings-panel">`,
              `<div class="panel-heading">`,
              `<h2>Reset account password</h2>${icon('lock')}</div>`,
              `<form id="reset-account-password-form" data-id="${user.id}" data-version="${user.version}">`,
              `<div class="form-error" tabindex="-1" role="alert" hidden>`,
              `</div>${credentials('reset')}${reason('reset')}${verification('reset')}<div class="form-actions">`,
              `<button type="submit" class="btn btn-secondary">Set temporary password</button>`,
              `</div>`,
              `</form>`,
              `</section>`,
            ].join('')
          : ''
      }</div>`,
        `
      <aside>`,
        `<section class="panel storage-card">`,
        `<span class="aside-icon">${icon('shield')}</span>`,
        `<h2>Account access</h2>`,
        `<p>Only administrators can change account roles or disable access. Every saved account change is recorded in the activity log.</p>`,
        `<p>Disabling access preserves submitted reports and account history.</p>`,
        `<a class="btn btn-secondary" href="#audit">View activity log</a>`,
        `</section>`,
        `</aside>`,
        `</div>`,
      ].join('');
    }
    async function auditLogPage() {
      const entries = await service.listAuditLog(auditFilters);
      const pageSize = 20;
      auditPage = Math.min(auditPage, Math.max(0, Math.ceil(entries.length / pageSize) - 1));
      const start = auditPage * pageSize;
      const changeValue = (field, value) =>
        field === 'role'
          ? roleLabel(value)
          : field === 'status'
            ? value === 'active'
              ? 'Active'
              : 'Disabled'
            : value;
      return [
        `${heading('', 'Activity Log', 'Review incident, announcement, account, and sign-in activity.')}
    <section class="panel audit-panel">`,
        `<h2 class="sr-only">Activity history</h2>`,
        `<form class="filters" id="audit-filters">`,
        `<div class="search-field">`,
        `<label class="sr-only" for="audit-search">Search activity history</label>`,
        `<div class="input-with-icon">${icon('search')}<input id="audit-search" name="query" type="search" value="${escape(auditFilters.query)}" maxlength="100" placeholder="Search names, references, titles, or details">`,
        `</div>`,
        `</div>`,
        `<label class="sr-only" for="activity-scope">Activity group</label><select id="activity-scope" name="scope"><option value="">All activity</option>${[
          ['accounts', 'Accounts & access'],
          ['incidents', 'Incident reviews'],
          ['announcements', 'Announcements'],
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}"${selected(auditFilters.scope, value)}>${label}</option>`,
          )
          .join('')}</select>`,
        `<label class="sr-only" for="audit-action-filter">Filter by event</label>`,
        `<select id="audit-action-filter" name="action">`,
        `<option value="">All events</option>${Object.entries(AUDIT_ACTIONS)
          .map(
            ([value, label]) =>
              `<option value="${value}"${selected(auditFilters.action, value)}>${label}</option>`,
          )
          .join('')}</select>`,
        `<button type="submit" class="btn btn-secondary">Search</button>${button('Clear', 'clear-audit-filters', 'text')}</form>
      ${
        entries.length
          ? [
              `<ol class="audit-list">${entries
                .slice(start, start + pageSize)
                .map((entry) =>
                  [
                    `<li class="audit-entry">`,
                    `<span class="audit-symbol">${icon(entry.resource?.type === 'incident' ? 'report' : entry.resource?.type === 'announcement' ? 'megaphone' : entry.action.startsWith('auth.') ? 'lock' : 'users')}</span>`,
                    `<div>`,
                    `<div class="audit-entry-heading">`,
                    `<h3>${AUDIT_ACTIONS[entry.action]}</h3>`,
                    `<time datetime="${entry.createdAt}">${date(entry.createdAt, true)}</time>`,
                    `</div>`,
                    `<p class="audit-actor">${entry.actor ? `${escape(entry.actor.name)} · ${escape(entry.actor.username)} · ${roleLabel(entry.actor.role)}` : entry.action === 'auth.sign_in_failed' ? 'Unsuccessful sign-in attempt' : entry.action === 'account.registered' ? 'Self-registration' : 'Account setup'}</p>${
                      entry.target
                        ? [
                            `<p class="audit-target">`,
                            `<strong>Account:</strong> ${escape(entry.target.name)} <span>(${escape(entry.target.username)})</span>`,
                            `</p>`,
                          ].join('')
                        : ''
                    }${adminActivityLink(entry)}${
                      entry.changes.length
                        ? `<ul class="audit-changes">${entry.changes
                            .map((c) =>
                              [
                                `<li>`,
                                `<strong>${escape(c.field === 'status' ? 'Access' : c.field[0].toUpperCase() + c.field.slice(1))}:</strong> ${escape(changeValue(c.field, c.from))} ${icon('arrow')} ${escape(changeValue(c.field, c.to))}</li>`,
                              ].join(''),
                            )
                            .join('')}</ul>`
                        : ''
                    }${
                      entry.reason
                        ? [
                            `<p class="audit-reason">`,
                            `<strong>${entry.resource ? 'Details' : 'Reason'}:</strong> ${escape(entry.reason)}</p>`,
                          ].join('')
                        : ''
                    }</div>`,
                    `</li>`,
                  ].join(''),
                )
                .join('')}</ol>`,
              `<div class="table-footer audit-pagination">`,
              `<span>${start + 1}–${Math.min(start + pageSize, entries.length)} of ${entries.length} events</span>`,
              `<div>${button(icon('back') + ' Previous', 'audit-previous', 'secondary', auditPage === 0 ? 'disabled' : '')}${button('Next ' + icon('arrow'), 'audit-next', 'secondary', start + pageSize >= entries.length ? 'disabled' : '')}</div>`,
              `</div>`,
            ].join('')
          : empty(
              'clock',
              'No matching events',
              'Saved reviews, announcements, and account events appear here. Try clearing the filters.',
              button('Clear filters', 'clear-audit-filters', 'secondary'),
            )
      }</section>`,
      ].join('');
    }

    // Profile, password, and browser data settings.
    function accountSettingsPage() {
      const forced = currentUser.mustChangePassword;
      const minimum = role === 'admin' ? 15 : 8;
      return `${forced ? '' : `<a class="back-link" href="#profile">${icon('back')}Back to profile</a>`}
        ${heading('', forced ? 'Activate your account' : 'Personal information & password', '')}
        ${forced ? callout('Replace your temporary password before using CMUAlert. Sign in again with your new password after saving.', 'info') : ''}
        <div class="settings-layout"><div>
          ${
            !forced
              ? `<section class="panel settings-panel">
            <div class="panel-heading"><h2>Personal information</h2>${icon('user')}</div>
            <form id="profile-form">
              <div class="form-error" tabindex="-1" role="alert" hidden></div>
              <div class="field"><label for="display-name">Full name</label>
                <input id="display-name" name="displayName" required maxlength="80" autocomplete="name" value="${escape(preferences.displayName)}">
              </div>
              <div class="form-grid">
                <div class="field"><label for="contact-email">Contact email <span class="optional">Optional</span></label>
                  <input id="contact-email" name="email" type="email" autocomplete="email" maxlength="120" value="${escape(preferences.contact?.email || '')}">
                </div>
                <div class="field"><label for="contact-phone">Contact number <span class="optional">Optional</span></label>
                  <input id="contact-phone" name="phone" type="tel" autocomplete="tel" maxlength="30" value="${escape(preferences.contact?.phone || '')}">
                </div>
              </div>
              <div class="account-details"><div><span>CMU ID / username</span><strong>${escape(currentUser.username)}</strong></div>
                <div><span>Account role</span><strong>${roleLabel(role)}</strong></div>
              </div>
              <div class="form-actions"><button class="btn btn-primary" type="submit">Save profile</button></div>
            </form>
          </section>`
              : ''
          }
          <section class="panel settings-panel">
            <div class="panel-heading"><h2>${forced ? 'Choose your own password' : 'Change your password'}</h2>${icon('lock')}</div>
            <form id="password-form"><div class="form-error" tabindex="-1" role="alert" hidden></div>
              <div class="field"><label for="current-password">${forced ? 'Temporary password' : 'Current password'}</label>
                <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128">
              </div>
              <div class="form-grid">
                <div class="field"><label for="new-password">New password</label>
                  <input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="${minimum}" maxlength="128">
                </div>
                <div class="field"><label for="confirm-password">Confirm new password</label>
                  <input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required minlength="${minimum}" maxlength="128">
                </div>
              </div>
              <div class="form-actions"><span class="small muted">Use ${minimum}–128 characters. A long, unique passphrase works well.</span>
                <button type="submit" class="btn btn-primary">Change password</button>
              </div>
            </form>
          </section>
        </div><aside><section class="panel storage-card"><span class="aside-icon">${icon('lock')}</span><h2>Your account</h2>
          <p>Your username and role are managed by the university administrator. Passwords are stored as verifiers and cannot be displayed.</p>
          <p>Contact details stay in this browser with your account. Email recovery is not connected.</p>
        </section></aside></div>`;
    }

    // Reference-inspired workspace features use the same authorized data service as reports.
    function onboardingGuide() {
      const steps =
        role === 'admin'
          ? [
              {
                icon: 'report',
                title: 'Review and respond to concerns',
                text: 'Open Incident reports to review details and evidence. Share progress with the reporter, keep internal notes separate, and document a resolution.',
              },
              {
                icon: 'megaphone',
                title: 'Keep the university informed',
                text: 'Publish announcements for the right audience. Start private Inbox conversations with account holders and manage permission to reply.',
              },
              {
                icon: 'users',
                title: 'Manage access responsibly',
                text: 'Create student and faculty / staff accounts, update access when needed, and review important account changes in the Activity log.',
              },
            ]
          : [
              {
                icon: 'megaphone',
                title: 'Share a campus concern',
                text: 'Choose an incident category, describe what happened, and review your report before submitting. A location and up to three photos are optional.',
              },
              {
                icon: 'lock',
                title: 'Follow your report’s progress',
                text: 'My Reports shows your identified reports and authorized updates. If you report anonymously, save the private tracking reference. You can add a My Reports passcode in Profile.',
              },
              {
                icon: 'inbox',
                title: 'Stay connected with your university',
                text: 'Read published announcements and Inbox messages. Request approval before replying to an administrator. Use Settings to adjust appearance and notification alerts.',
              },
            ];
      const step = steps[onboardingStep];
      return `<section class="panel onboarding-card" aria-labelledby="onboarding-title">
        <div class="onboarding-heading"><div><p class="onboarding-label">GETTING STARTED · ${onboardingStep + 1} OF ${steps.length}</p><h2 id="onboarding-title" tabindex="-1">Welcome to CMUAlert</h2></div><button class="icon-button" data-action="onboarding-dismiss" aria-label="Dismiss welcome guide">${icon('close')}</button></div>
        <div class="onboarding-content"><span class="preference-icon">${icon(step.icon)}</span><div><h3 id="onboarding-step-title" tabindex="-1" aria-describedby="onboarding-step-copy">${step.title}</h3><p id="onboarding-step-copy">${step.text}</p></div></div>
        <div class="onboarding-footer"><div class="onboarding-progress" role="group" aria-label="Guide progress">${steps.map((_, index) => `<span ${index === onboardingStep ? 'aria-current="step"' : ''}><span class="sr-only">Step ${index + 1}${index === onboardingStep ? ', current' : ''}</span></span>`).join('')}</div><div>${onboardingStep > 0 ? button('Back', 'onboarding-back', 'text') : ''}${button('Skip guide', 'onboarding-dismiss', 'text')}${button(onboardingStep === steps.length - 1 ? 'Finish guide' : 'Next ' + icon('arrow'), onboardingStep === steps.length - 1 ? 'onboarding-dismiss' : 'onboarding-next')}</div></div>
      </section>`;
    }
    function reportingGuide() {
      const rows =
        role === 'admin'
          ? [
              [
                'Review incidents',
                'Open Incident reports to review submitted concerns and supporting evidence.',
              ],
              [
                'Record progress',
                'Follow the status workflow. Reporter-visible updates are shared; internal notes and actions remain in administration.',
              ],
              [
                'Stay connected',
                'Publish announcements or start a private Inbox conversation. Approve reply requests when a response is appropriate.',
              ],
              [
                'Manage account access',
                'Create or update student and staff accounts. Important account and role changes appear in Activity log.',
              ],
            ]
          : [
              [
                'Share your concern',
                'Choose a category, add the details, and select identified or anonymous reporting.',
              ],
              [
                'Review and submit',
                'Check your information. A reference is created only after the report is saved.',
              ],
              [
                'Follow the progress',
                'Use My reports for identified submissions or your private tracking reference for anonymous reports.',
              ],
              [
                'Stay connected',
                'Read announcements and Inbox messages. Request permission before replying to an administrator conversation.',
              ],
            ];
      return (
        '<ol class="reporting-guide">' +
        rows
          .map(
            ([title, text], index) =>
              '<li><span>' +
              (index + 1) +
              '</span><div><h3>' +
              title +
              '</h3><p>' +
              text +
              '</p></div></li>',
          )
          .join('') +
        '</ol>'
      );
    }
    function greeting() {
      const hour = new Date().getHours();
      return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    }
    function avatarContent() {
      return preferences.avatar
        ? `<img src="${preferences.avatar}" alt="" width="64" height="64">`
        : escape(
            (preferences.displayName || 'CMU')
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p) => p[0])
              .join('')
              .toUpperCase(),
          );
    }
    function applyAppearance(value) {
      appearance = value;
      document.documentElement.dataset.theme = value.theme;
      document.documentElement.dataset.fontSize = value.fontSize;
      document.documentElement.style.setProperty(
        '--text-scale',
        { small: 0.94, medium: 1, large: 1.16 }[value.fontSize],
      );
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', value.theme === 'dark' ? '#111d31' : '#0b2d6b');
    }
    async function refreshActivityBadge() {
      if (!currentUser || currentUser.mustChangePassword) return;
      const [activity, conversations, preference] = await Promise.all([
        service.listActivity(),
        service.listConversations(),
        service.getPreferences(),
      ]);
      activityCache = activity;
      const unread = activity.filter((a) => !a.read).length;
      const bell = document.querySelector('.notification-bell');
      const count = bell?.querySelector('.notification-count');
      if (count) {
        count.textContent = unread > 99 ? '99+' : unread;
        count.hidden = !unread || !preference.allowNotifications;
      }
      bell?.setAttribute(
        'aria-label',
        preference.allowNotifications && unread
          ? `Notifications, ${unread} unread`
          : 'Notifications',
      );
      const inboxUnread = conversations.reduce((total, c) => total + c.unread, 0);
      for (const link of document.querySelectorAll('[data-route="inbox"]')) {
        link.querySelector('.inbox-count')?.remove();
        if (inboxUnread)
          link.insertAdjacentHTML(
            'beforeend',
            `<span class="inbox-count">${inboxUnread}<span class="sr-only"> unread messages</span></span>`,
          );
      }
      const avatar = document.querySelector('.user-chip .avatar');
      if (avatar) avatar.innerHTML = avatarContent();
    }
    function settingsPage() {
      const notificationTab = settingsTab === 'notifications';
      const dataTab = settingsTab === 'data';
      return `${heading('', 'Settings', 'Make CMUAlert comfortable to use on this device.')}
        <div class="settings-tabs" role="group" aria-label="Settings sections">
          ${[
            ['appearance', 'moon', 'Appearance'],
            ['notifications', 'bell', 'Notifications'],
            ...(role === 'admin' ? [['data', 'archive', 'Browser data']] : []),
          ]
            .map(
              ([value, symbol, label]) =>
                `<button class="btn ${settingsTab === value ? 'btn-primary' : 'btn-secondary'}" data-action="settings-tab" data-tab="${value}" aria-pressed="${settingsTab === value}">${icon(symbol)}${label}</button>`,
            )
            .join('')}
        </div>
        <section class="panel preference-panel">
        ${
          dataTab
            ? `<h2>Browser data</h2><p>Accounts, reports, conversations, and preferences are saved in this browser. They do not sync across devices.</p>
          <div class="preference-row"><div><h3>Download saved records</h3><p>Contains private records and credential verifiers. Attachments are excluded.</p></div>${button(icon('download') + ' Download records', 'backup-data', 'secondary')}</div>
          <div class="preference-row"><div><h3>Reset CMUAlert</h3><p>Permanently delete accounts and records from this browser.</p></div>${button('Reset local data', 'reset-data', 'danger-outline')}</div>`
            : notificationTab
              ? `<h2>Notifications</h2><p>Choose whether the bell shows unread activity while you use CMUAlert.</p>
          <div class="preference-row"><span class="preference-icon">${icon('bell')}</span><div><h3>Show notification alerts</h3><p>Report updates, inbox activity, and published announcements.</p></div><button class="switch" role="switch" aria-label="Show notification alerts" aria-checked="${preferences.allowNotifications}" data-action="toggle-notifications"><span></span></button></div>
          ${callout(preferences.allowNotifications ? 'Alerts appear in CMUAlert while the system is open. Open the bell to review your activity.' : 'Notification alerts are off. You can still open the bell and read your inbox and announcements.', preferences.allowNotifications ? 'info' : 'warning')}
          <p class="settings-footnote">Email, SMS, and alerts while the browser is closed are not connected.</p>`
              : `<h2>Appearance</h2><p>Choose the theme and text size for this browser.</p>
          <div class="preference-row"><span class="preference-icon">${icon('moon')}</span><div><h3>Dark mode</h3><p>A darker appearance for low-light environments.</p></div><button class="switch" role="switch" aria-label="Dark mode" aria-checked="${appearance.theme === 'dark'}" data-action="toggle-theme"><span></span></button></div>
          <div class="preference-row font-preference"><span class="preference-icon">A</span><div><h3>Text size</h3><p>Adjust text for comfortable reading.</p><div class="font-size-options" role="group" aria-label="Text size">${[
            ['small', 'Small'],
            ['medium', 'Medium'],
            ['large', 'Large'],
          ]
            .map(
              ([value, label]) =>
                `<button data-action="set-font" data-size="${value}" class="${appearance.fontSize === value ? 'selected' : ''}" aria-pressed="${appearance.fontSize === value}" aria-label="A ${label} text"><span aria-hidden="true">A</span> <small>${label}</small></button>`,
            )
            .join('')}</div></div></div>`
        }
        </section><div class="welcome-guide-link">${button(icon('help') + ' View welcome guide', 'replay-onboarding', 'text')}</div>`;
    }
    function profilePage() {
      return `${heading('', 'Profile', 'Your university account and personal preferences.')}
        <div class="profile-layout"><section class="panel profile-summary"><div class="profile-avatar-wrap"><span class="profile-avatar">${avatarContent()}</span><label class="photo-picker" for="profile-photo" aria-label="Change profile photo">${icon('camera')}<input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose a profile photo"></label></div><div><h2>${escape(preferences.displayName)}</h2><p>${escape(currentUser.username)}</p><span class="account-status is-active">${roleLabel(role)}</span></div>${preferences.avatar ? button('Remove photo', 'remove-avatar', 'text') : ''}<p class="profile-photo-help">Profile photo: JPG, PNG, or WebP, up to 2 MB.</p></section>
        <div class="profile-menu panel"><a href="#profile/details">${icon('user')}<div><strong>Personal information & password</strong><small>Manage your details and account password</small></div>${icon('chevron')}</a>
        ${role !== 'admin' ? `<a href="#profile/passcode">${icon('lock')}<div><strong>My reports passcode</strong><small>${preferences.hasReportsPasscode ? 'Change or remove your passcode' : 'Add an optional six-digit reports lock'}</small></div>${icon('chevron')}</a><a href="#track">${icon('search')}<div><strong>Track an anonymous report</strong><small>Use your private tracking reference</small></div>${icon('chevron')}</a>` : ''}
        <a href="#settings">${icon('settings')}<div><strong>Settings</strong><small>Appearance and notification preferences</small></div>${icon('chevron')}</a></div></div>
        <button class="btn btn-danger-outline profile-signout" data-action="sign-out">${icon('logout')}Sign out</button>`;
    }
    function passcodePage() {
      return `<a href="#profile" class="back-link">${icon('back')}Back to profile</a>${heading('', 'My reports passcode', 'An optional extra lock for your identified report details.')}
        <section class="panel preference-panel"><h2>${preferences.hasReportsPasscode ? 'Change your passcode' : 'Set a reports passcode'}</h2><p>Unlocks My reports in this tab for 15 minutes. Anonymous tracking continues to use its private reference.</p>
        <form id="passcode-form"><div class="form-error" tabindex="-1" role="alert" hidden></div><div class="field"><label for="passcode-password">Account password</label><input id="passcode-password" name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></div>
        <div class="form-grid"><div class="field"><label for="new-passcode">New six-digit passcode</label><input id="new-passcode" class="passcode-input" name="passcode" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off"></div><div class="field"><label for="confirm-passcode">Confirm passcode</label><input id="confirm-passcode" class="passcode-input" name="confirmPasscode" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off"></div></div>
        <div class="form-actions">${preferences.hasReportsPasscode ? '<button type="submit" name="intent" value="remove" class="btn btn-danger-outline">Remove passcode</button>' : ''}<button type="submit" class="btn btn-primary" name="intent" value="save">Save passcode</button></div></form><p class="settings-footnote">Forgot your passcode? Set a new one here using your account password. This lock does not encrypt browser storage.</p></section>`;
    }
    function reportsUnlockPage() {
      return `${heading('', 'My reports', '')}<section class="panel unlock-panel"><span class="preference-icon">${icon('lock')}</span><h2>Your reports are locked</h2><p>Enter your six-digit reports passcode to view your identified reports.</p><form id="unlock-reports-form"><div class="form-error" role="alert" tabindex="-1" hidden></div><div class="field"><label for="reports-passcode">Reports passcode</label><input id="reports-passcode" class="passcode-input" name="passcode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></div><button class="btn btn-primary" type="submit">${icon('lock')}Unlock My reports</button></form><a href="#profile/passcode" class="text-link">Forgot your passcode?</a></section>`;
    }
    async function inboxPage() {
      const conversations = await service.listConversations();
      inboxCurrent = null;
      return `${heading('', 'Inbox', role === 'admin' ? 'Private conversations with university account holders.' : 'Private messages from your university administrator.', role === 'admin' ? link(icon('plus') + ' New conversation', '#inbox/new') : '')}
        <section class="panel inbox-list">${conversations.length ? conversations.map((c) => `<a class="conversation-row ${c.unread ? 'unread' : ''}" href="#inbox/${c.id}"><span class="preference-icon">${icon('inbox')}</span><div><span class="conversation-meta">${escape(role === 'admin' ? c.participantName : 'University administrator')} · ${date(c.updatedAt, true)}</span><h2>${escape(c.subject)}</h2><p>${escape(c.messages.at(-1).text.slice(0, 120))}</p>${c.replyStatus === 'pending' ? '<span class="reply-label">Reply approval requested</span>' : ''}</div>${c.unread ? `<span class="unread-badge">${c.unread}<span class="sr-only"> unread messages</span></span>` : icon('chevron')}</a>`).join('') : empty('inbox', 'No messages yet', role === 'admin' ? 'Start a conversation with an active student or faculty / staff account.' : 'Messages from your administrator will appear here.')}</section>
        ${role !== 'admin' ? callout('Your administrator starts each conversation. Open a message and request permission to reply. Incident reports and anonymous tracking stay in their own pages.', 'info') : ''}`;
    }
    async function newConversationPage() {
      const accounts = (await service.listAccounts()).filter(
        (a) => a.role !== 'admin' && a.status === 'active',
      );
      return `<a href="#inbox" class="back-link">${icon('back')}Back to inbox</a>${heading('', 'New conversation', 'Send a private message to an account holder.')}
        <section class="panel preference-panel">${!accounts.length ? empty('users', 'No recipients available', 'Create a student or faculty / staff account first.', link('Manage accounts', '#accounts', 'secondary')) : `<form id="conversation-form"><div class="form-error" role="alert" tabindex="-1" hidden></div><div class="field"><label for="message-recipient">Recipient</label><select id="message-recipient" name="participantId" required><option value="">Choose an account</option>${accounts.map((a) => `<option value="${a.id}">${escape(a.name)} · ${escape(a.username)}</option>`).join('')}</select></div><div class="field"><label for="message-subject">Subject</label><input id="message-subject" name="subject" required maxlength="160"></div><div class="field"><label for="first-message">Message</label><textarea id="first-message" name="message" rows="6" maxlength="5000" required></textarea></div><p class="privacy-note">Keep anonymous reporting identities and confidential investigation details out of messages.</p><div class="form-actions"><button type="submit" class="btn btn-primary">${icon('mail')}Send message</button></div></form>`}</section>`;
    }
    function conversationContents(c) {
      const admin = role === 'admin';
      const messages = c.messages
        .map(
          (m) =>
            `<article class="message-bubble ${m.authorId === currentUser.id ? 'outgoing' : ''}"><div><strong>${m.authorId === currentUser.id ? 'You' : m.authorRole === 'admin' ? 'University administrator' : escape(c.participantName)}</strong><time datetime="${m.createdAt}">${date(m.createdAt, true)}</time></div><p class="preserve-lines">${escape(m.text)}</p></article>`,
        )
        .join('');
      let permission = '';
      if (admin)
        permission = `<div class="reply-controls"><p>${c.replyStatus === 'pending' ? 'The account holder requested permission to reply.' : c.replyStatus === 'approved' ? 'The account holder can reply to this conversation.' : 'Replies are currently disabled for the account holder.'}</p>${c.replyStatus !== 'approved' ? button('Allow replies', 'reply-permission', 'secondary', `data-decision="approved"`) : button('Disable replies', 'reply-permission', 'secondary', 'data-decision="denied"')}${c.replyStatus === 'pending' ? button('Decline request', 'reply-permission', 'text', 'data-decision="denied"') : ''}</div>`;
      else if (c.replyStatus !== 'approved')
        permission = `<div class="reply-controls"><p>${c.replyStatus === 'pending' ? 'Your reply request is waiting for administrator approval.' : c.replyStatus === 'denied' ? 'Replies are disabled. You may request permission again.' : 'Request permission from your administrator before replying.'}</p>${c.replyStatus !== 'pending' ? button('Request to reply', 'reply-permission', 'secondary', 'data-decision="pending"') : ''}</div>`;
      return { messages, permission };
    }
    async function conversationPage(id) {
      const c = await service.getConversation(id);
      inboxCurrent = c;
      await service.markConversationRead(id);
      const contents = conversationContents(c);
      const related = (await service.listActivity()).filter((a) => a.href === `#inbox/${id}`);
      await service.markActivityRead(related.map((a) => a.id));
      return `<a class="back-link" href="#inbox">${icon('back')}Back to inbox</a>${heading('', escape(c.subject), role === 'admin' ? escape(c.participantName) : 'University administrator')}
        <section class="panel conversation-panel"><div id="conversation-messages" class="message-list" aria-label="Conversation messages">${contents.messages}</div><div id="reply-permission">${contents.permission}</div>
        <form id="message-form" data-version="${c.version}" ${!c.participantActive || (role !== 'admin' && c.replyStatus !== 'approved') ? 'hidden' : ''}><div class="form-error" role="alert" tabindex="-1" hidden></div><div class="field"><label for="reply-message">Your message</label><textarea id="reply-message" name="message" required rows="4" maxlength="5000"></textarea></div><div class="form-actions"><button type="submit" class="btn btn-primary">${icon('mail')}Send message</button></div></form>${!c.participantActive ? callout('Messaging is paused because this account is disabled.', 'warning') : ''}</section>`;
    }
    async function notificationsPage() {
      const activity = await service.listActivity();
      return `${heading('', 'Notifications', 'Report updates, university messages, and announcements.', activity.some((a) => !a.read) ? button('Mark all as read', 'read-all-activity', 'secondary') : '')}
        ${!preferences.allowNotifications ? callout('Notification alerts are off. You can still review activity here.', 'info') : ''}
        <section class="panel activity-list">${activity.length ? activity.map((a) => `<button class="activity-row ${a.read ? '' : 'unread'}" data-action="open-activity" data-id="${escape(a.id)}"><span class="preference-icon">${icon(a.id.startsWith('message:') ? 'inbox' : 'bell')}</span><span><strong>${escape(a.title)}</strong><span>${escape(a.detail)}</span><time datetime="${a.createdAt}">${date(a.createdAt, true)}</time></span>${a.read ? '' : '<span class="activity-dot"><span class="sr-only">Unread</span></span>'}${icon('chevron')}</button>`).join('') : empty('bell', 'You’re all caught up', 'Activity will appear when there are report updates, messages, or published announcements.')}</section>`;
    }
    function releaseFilePreviews() {
      for (const url of filePreviewURLs.values()) URL.revokeObjectURL(url);
      filePreviewURLs.clear();
    }
    function clearTracking() {
      // Discard pending lookups and refreshes before removing the displayed information.
      trackingRequestId++;
      tracked = null;
      trackingValue = '';
      trackingOutcome = '';
    }

    function clearLocalView() {
      clearTimeout(reportsLockTimer);
      settingsTab = 'appearance';
      onboardingStep = 0;
      onboardingPreview = false;
      releaseFilePreviews();
      inboxCurrent = null;
      activityCache = [];
      clearTimeout(sessionTimer);
      currentUser = null;
      role = 'student';
      shellIdentity = '';
      reportDraft = null;
      receipt = null;
      reportStep = 0;
      announcementDraft = null;
      announcementDirty = false;
      clearTracking();
      currentIncident = null;
      filters = defaultReportFilters();
      adminQueueFilters = defaultAdminQueueFilters();
      adminQueuePage = 0;
      adminQueueAdvanced = false;
      announcementFilters = { query: '', category: '', status: '' };
      accountFilters = { query: '', role: '', status: '' };
      auditFilters = { query: '', action: '', scope: '' };
      auditPage = 0;
      closeNavigation();
      if (dialog.open) dialog.close('cancel');
    }
    function downloadText(filename, contents, type = 'application/json') {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function downloadReceipt(report) {
      const lines = [
        'CMUAlert — Report submission receipt',
        'City of Malabon University',
        '',
        `Report reference: ${report.reference}`,
        `Category: ${categoryById(report.category).name}`,
        `Reporting mode: ${report.mode === 'anonymous' ? 'Anonymous' : 'Identified'}`,
        `Status at submission: ${report.status}`,
        `Submitted: ${date(report.createdAt, true)}`,
      ];
      if (report.mode === 'anonymous')
        lines.push(
          '',
          `Private tracking reference: ${report.trackingReference}`,
          'Keep this tracking reference private. Use it to view permitted report updates.',
        );
      const reference = report.reference.replace(/[^A-Za-z0-9_-]/g, '');
      downloadText(
        `cmualert-receipt-${reference}.txt`,
        lines.join('\n') + '\n',
        'text/plain;charset=utf-8',
      );
    }
    // Form event bindings. All record changes go through the data service.
    function bindAccess() {
      const form = document.querySelector('#access-form');
      if (!form) return;
      form.addEventListener('input', () => {
        form.dataset.dirty = 'true';
      });
      form.onsubmit = (e) => {
        e.preventDefault();
        saving(form, async () => {
          const input = Object.fromEntries(new FormData(form));
          if (form.dataset.kind === 'login') {
            await service.signIn(input.username, input.password);
            clearLocalView();
            acceptingNavigation = true;
            location.hash = '#dashboard';
            await render({ focus: true });
          } else {
            if (form.dataset.kind === 'setup') {
              if (
                !(await confirmAction(
                  'Create the first administrator?',
                  '<p>This account can manage reports, announcements, and student and staff access. Complete setup only if you are authorized. You must sign in after creating the account.</p>',
                  'Create administrator',
                ))
              )
                return;
              await service.setupAdministrator(input);
            } else if (input.accountType === 'faculty') await service.registerFaculty(input);
            else await service.registerStudent(input);
            loginUsername = input.username.trim();
            form.reset();
            delete form.dataset.dirty;
            acceptingNavigation = true;
            location.hash = '#login';
            toast('Account created. Sign in to continue.');
          }
        });
      };
    }

    function captureReport() {
      const form = document.querySelector('#report-form');
      if (form && reportDraft) Object.assign(reportDraft, Object.fromEntries(new FormData(form)));
    }
    function captureAnnouncement() {
      const form = document.querySelector('#announcement-form');
      if (!form) return announcementDraft;
      announcementDraft = {
        ...announcementDraft,
        ...Object.fromEntries(new FormData(form)),
        pinned: form.elements.pinned.checked,
      };
      return announcementDraft;
    }

    async function profilePhoto(file) {
      if (
        !file ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        !file.size ||
        file.size > 2 * 1024 * 1024
      )
        throw new Error('Choose a JPG, PNG, or WebP photo up to 2 MB.');
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const size = Math.min(bitmap.width, bitmap.height);
        canvas
          .getContext('2d')
          .drawImage(
            bitmap,
            (bitmap.width - size) / 2,
            (bitmap.height - size) / 2,
            size,
            size,
            0,
            0,
            256,
            256,
          );
        return canvas.toDataURL('image/jpeg', 0.85);
      } finally {
        bitmap.close();
      }
    }
    function bindWorkspaceFeatures() {
      const photo = document.querySelector('#profile-photo');
      if (photo)
        photo.onchange = async () => {
          photo.disabled = true;
          try {
            await service.saveAvatar(await profilePhoto(photo.files[0]));
            await render();
            toast('Profile photo saved.');
          } catch (error) {
            toast(error.message, 'error');
          } finally {
            photo.disabled = false;
          }
        };
      for (const form of document.querySelectorAll('#conversation-form, #message-form')) {
        form.oninput = () => {
          form.dataset.dirty = 'true';
        };
        form.onchange = () => {
          form.dataset.dirty = 'true';
        };
        form.onsubmit = (event) => {
          event.preventDefault();
          saving(form, async () => {
            const values = Object.fromEntries(new FormData(form));
            if (form.id === 'conversation-form') {
              const created = await service.createConversation(values);
              delete form.dataset.dirty;
              acceptingNavigation = true;
              location.hash = `#inbox/${created.id}`;
            } else {
              await service.sendMessage(inboxCurrent.id, {
                message: values.message,
                expectedVersion: Number(form.dataset.version),
              });
              delete form.dataset.dirty;
              form.reset();
              await render();
            }
            toast('Message sent.');
          });
        };
      }
      const passcodeForm = document.querySelector('#passcode-form');
      if (passcodeForm)
        passcodeForm.onsubmit = (event) => {
          event.preventDefault();
          const remove = event.submitter?.value === 'remove';
          saving(passcodeForm, async () => {
            if (
              remove &&
              !(await confirmAction(
                'Remove your reports passcode?',
                '<p>Your account login will still be required to view identified reports.</p>',
                'Remove passcode',
              ))
            )
              return;
            await service.setReportsPasscode({
              ...Object.fromEntries(new FormData(passcodeForm)),
              remove,
            });
            passcodeForm.reset();
            acceptingNavigation = true;
            location.hash = '#profile';
            toast(remove ? 'Reports passcode removed.' : 'Reports passcode saved.');
          });
        };
      const unlockForm = document.querySelector('#unlock-reports-form');
      if (unlockForm)
        unlockForm.onsubmit = (event) => {
          event.preventDefault();
          saving(unlockForm, async () => {
            await service.unlockReports(unlockForm.elements.passcode.value);
            unlockForm.reset();
            await render();
          });
        };
    }
    function bindView() {
      bindWorkspaceFeatures();
      const queueFilters = document.querySelector('#admin-queue-filters');
      if (queueFilters) {
        queueFilters.addEventListener('input', () => {
          queueFilters.dataset.dirty = 'true';
        });
        queueFilters.querySelector('details').ontoggle = (event) => {
          if (queueFilters.isConnected) adminQueueAdvanced = event.target.open;
        };
        queueFilters.onsubmit = (event) => {
          event.preventDefault();
          adminQueueAdvanced = queueFilters.querySelector('details').open;
          saving(queueFilters, async () => {
            const values = Object.fromEntries(new FormData(queueFilters));
            // Validate before changing the displayed filter state.
            await service.listReports({ role: 'admin', ...values });
            adminQueueFilters = values;
            adminQueuePage = 0;
            delete queueFilters.dataset.dirty;
            await render();
          });
        };
        queueFilters.querySelectorAll('select, input[type="date"]').forEach((control) => {
          control.onchange = () => queueFilters.requestSubmit();
        });
      }
      for (const [selector, update] of [
        [
          '#account-filters',
          (values) => {
            accountFilters = values;
          },
        ],
        [
          '#audit-filters',
          (values) => {
            auditFilters = values;
            auditPage = 0;
          },
        ],
      ]) {
        const form = document.querySelector(selector);
        if (!form) continue;
        form.onsubmit = (e) => {
          e.preventDefault();
          update(Object.fromEntries(new FormData(form)));
          render();
        };
        form
          .querySelectorAll('select')
          .forEach((select) => (select.onchange = () => form.requestSubmit()));
      }
      for (const form of document.querySelectorAll(
        '#manage-account-form, #reset-account-password-form',
      )) {
        form.addEventListener('input', () => {
          form.dataset.dirty = 'true';
        });
        form.addEventListener('change', () => {
          form.dataset.dirty = 'true';
        });
        form.onsubmit = (e) => {
          e.preventDefault();
          saving(form, async () => {
            const values = {
              ...Object.fromEntries(new FormData(form)),
              expectedVersion: Number(form.dataset.version),
            };
            if (form.id === 'reset-account-password-form') {
              if (
                !(await confirmAction(
                  'Reset this account’s password?',
                  '<p>Active sessions will end. The account holder must change the temporary password after their next sign-in.</p>',
                  'Set temporary password',
                ))
              )
                return;
              await service.resetAccountPassword(form.dataset.id, values);
              delete form.dataset.dirty;
              await render();
              toast('Temporary password set. Share it privately with the account holder.');
            } else if (form.dataset.id) {
              await service.updateAccount(form.dataset.id, values);
              delete form.dataset.dirty;
              await render();
              toast('Account changes saved and recorded in the activity log.');
            } else {
              await service.createManagedAccount(values);
              delete form.dataset.dirty;
              acceptingNavigation = true;
              location.hash = '#accounts';
              toast(
                'Account created. Share the temporary password privately with the account holder.',
              );
            }
          });
        };
      }
      const categoryForm = document.querySelector('#category-form');
      if (categoryForm) {
        categoryForm.onchange = (event) => {
          if (!event.target.matches('input[name="category"]')) return;
          reportDraft.category = event.target.value;
          if (!categoryById(reportDraft.category)?.allowAnonymous) reportDraft.mode = 'identified';
          document.querySelector('#category-selection-note').textContent =
            'Selected: ' + categoryById(reportDraft.category).name;
          categoryForm.querySelector('[data-action="clear-category"]').disabled = false;
        };
        categoryForm.onsubmit = (e) => {
          e.preventDefault();
          reportDraft.category = new FormData(categoryForm).get('category');
          reportStep = 1;
          render({ focus: true });
        };
      }
      const reportForm = document.querySelector('#report-form');
      if (reportForm) {
        reportForm.addEventListener('input', captureReport);
        reportForm.onsubmit = (e) => {
          e.preventDefault();
          captureReport();
          try {
            service.validateReport(reportDraft);
            validateFiles(reportDraft.files);
            reportStep = 2;
            render({ focus: true });
          } catch (error) {
            formError(reportForm, error);
          }
        };
        document.querySelector('#attachments').onchange = (e) => {
          captureReport();
          try {
            const selected = [...reportDraft.files, ...e.target.files];
            validateFiles(selected);
            reportDraft.files = selected;
            clearFormSummary(reportForm);
            document.querySelector('#selected-files').innerHTML = selectedFiles();
          } catch (error) {
            formError(reportForm, error);
          }
          e.target.value = '';
        };
        const uploadZone = document.querySelector('.upload-zone');
        uploadZone.ondragover = (event) => {
          event.preventDefault();
          uploadZone.classList.add('dragging');
        };
        uploadZone.ondragleave = () => uploadZone.classList.remove('dragging');
        uploadZone.ondrop = (event) => {
          event.preventDefault();
          uploadZone.classList.remove('dragging');
          captureReport();
          try {
            const files = [...reportDraft.files, ...event.dataTransfer.files];
            validateFiles(files);
            reportDraft.files = files;
            clearFormSummary(reportForm);
            document.querySelector('#selected-files').innerHTML = selectedFiles();
          } catch (error) {
            formError(reportForm, error);
          }
        };
      }
      const submitReport = document.querySelector('#submit-report-form');
      if (submitReport)
        submitReport.onsubmit = (e) => {
          e.preventDefault();
          saving(submitReport, async () => {
            const saved = await service.createReport(reportDraft, {
              files: reportDraft.files,
              submissionId: reportDraft.submissionId,
            });
            receipt = saved;
            reportStep = 3;
            if (saved.mode === 'anonymous') trackingValue = saved.trackingReference;
            reportDraft = null;
            releaseFilePreviews();
            await render({ focus: true });
          });
        };
      const reportFilters = document.querySelector('#report-filters');
      if (reportFilters) {
        reportFilters.addEventListener('input', () => {
          reportFilters.dataset.dirty = 'true';
        });
        reportFilters.onsubmit = (e) => {
          e.preventDefault();
          saving(reportFilters, async () => {
            const values = Object.fromEntries(new FormData(reportFilters));
            await service.listReports({ role, ...values });
            filters = values;
            delete reportFilters.dataset.dirty;
            await render();
          });
        };
        reportFilters
          .querySelectorAll('select')
          .forEach((s) => (s.onchange = () => reportFilters.requestSubmit()));
      }
      const announcementFilterForm = document.querySelector('#announcement-filters');
      if (announcementFilterForm) {
        announcementFilterForm.onsubmit = (e) => {
          e.preventDefault();
          announcementFilters = {
            status: '',
            ...Object.fromEntries(new FormData(announcementFilterForm)),
          };
          render();
        };
        announcementFilterForm
          .querySelectorAll('select')
          .forEach((s) => (s.onchange = () => announcementFilterForm.requestSubmit()));
      }
      const trackingForm = document.querySelector('#tracking-form');
      if (trackingForm) {
        trackingForm.addEventListener('input', () => {
          trackingForm.dataset.dirty = 'true';
          trackingRequestId++;
          tracked = null;
          trackingOutcome = '';
          clearFormSummary(trackingForm);
          clearFieldError(trackingForm.elements.reference);
          document.querySelector('#tracking-results').innerHTML = trackingEmptyState();
        });
        trackingForm.onsubmit = (e) => {
          e.preventDefault();
          saving(trackingForm, async () => {
            const requestId = ++trackingRequestId;
            trackingValue = new FormData(trackingForm).get('reference').trim();
            tracked = null;
            trackingOutcome = '';
            try {
              const result = await service.trackAnonymous(trackingValue);
              if (requestId !== trackingRequestId || location.hash.split('?')[0] !== '#track')
                return;
              tracked = result;
              await render();
            } catch (error) {
              if (requestId !== trackingRequestId || location.hash.split('?')[0] !== '#track')
                return;
              trackingOutcome = error.code || 'error';
              await render();
              if (requestId === trackingRequestId)
                formError(document.querySelector('#tracking-form'), error);
            }
          });
        };
      }
      const updateForm = document.querySelector('#update-incident-form');
      if (updateForm) {
        updateForm.addEventListener('input', () => {
          updateForm.dataset.dirty = 'true';
        });
        updateForm.addEventListener('change', () => {
          updateForm.dataset.dirty = 'true';
        });
        const status = updateForm.elements.status;
        status.onchange = () => {
          const resolved = status.value === 'Resolved';
          document.querySelector('#resolution-field').hidden = !resolved;
          updateForm.elements.resolution.required =
            resolved && currentIncident.status !== 'Resolved';
          updateForm.elements.publicUpdate.required = status.value !== currentIncident.status;
        };
        updateForm.onsubmit = (e) => {
          e.preventDefault();
          saving(updateForm, async () => {
            const values = Object.fromEntries(new FormData(updateForm));
            if (values.status !== 'Resolved') values.resolution = '';
            if (
              !(await confirmAction(
                'Save incident update?',
                [
                  `<p>This will record your update${values.status !== currentIncident.status ? ` and change the status to <strong>${escape(values.status)}</strong>` : ''}.</p>`,
                  `<p>Reporter-visible updates and resolution details will be available in the reporter’s view. Internal notes and actions remain in the administrator workspace.</p>`,
                ].join(''),
                'Save update',
              ))
            )
              return;
            await service.updateIncident(updateForm.dataset.id, {
              ...values,
              expectedVersion: Number(updateForm.dataset.version),
            });
            await render();
            toast('Incident update saved.');
          });
        };
      }
      const announcementForm = document.querySelector('#announcement-form');
      if (announcementForm) {
        announcementForm.addEventListener('input', () => {
          captureAnnouncement();
          announcementDirty = true;
        });
        announcementForm.addEventListener('change', () => {
          captureAnnouncement();
          announcementDirty = true;
        });
        announcementForm.onsubmit = (e) => {
          e.preventDefault();
          const intent = e.submitter?.value || 'Draft';
          saving(announcementForm, async () => {
            const values = captureAnnouncement();
            if (
              intent === 'Published' &&
              !(await confirmAction(
                'Publish this announcement?',
                [
                  `<p>The announcement will appear for <strong>${escape(values.audience)}</strong>.</p>`,
                  `<p>Check that the content contains no confidential report details or identities.</p>`,
                ].join(''),
                'Publish announcement',
              ))
            )
              return;
            await service.saveAnnouncement({
              ...values,
              status: intent,
              expectedVersion: values.version,
            });
            announcementDraft = null;
            announcementDirty = false;
            acceptingNavigation = true;
            location.hash = '#announcements';
            toast(
              intent === 'Published'
                ? 'Announcement published for the selected audience.'
                : 'Announcement saved as a draft.',
            );
          });
        };
      }
      const passwordForm = document.querySelector('#password-form');
      if (passwordForm)
        passwordForm.onsubmit = (e) => {
          e.preventDefault();
          saving(passwordForm, async () => {
            if (
              dirtyProfileForm() &&
              !(await confirmAction(
                'Change password with unsaved profile changes?',
                '<p>Your password change will sign you out. Unsaved profile changes will be discarded.</p>',
                'Change password',
              ))
            )
              return;
            const values = Object.fromEntries(new FormData(passwordForm));
            const username = currentUser.username;
            await service.changePassword(
              values.currentPassword,
              values.password,
              values.confirmPassword,
            );
            passwordForm.reset();
            clearLocalView();
            loginUsername = username;
            acceptingNavigation = true;
            location.hash = '#login';
            toast('Password changed. Sign in with your new password.');
          });
        };
      const profileForm = document.querySelector('#profile-form');
      if (profileForm)
        profileForm.onsubmit = (e) => {
          e.preventDefault();
          saving(profileForm, async () => {
            await service.saveProfile(profileForm.elements.displayName.value, {
              email: profileForm.elements.email.value,
              phone: profileForm.elements.phone.value,
            });
            preferences = await service.getPreferences();
            currentUser.name = preferences.displayName;
            profileForm.elements.displayName.value = preferences.displayName;
            profileForm.elements.displayName.defaultValue = preferences.displayName;
            for (const field of ['email', 'phone']) {
              profileForm.elements[field].value = preferences.contact[field];
              profileForm.elements[field].defaultValue = preferences.contact[field];
            }
            const chip = document.querySelector('.user-chip strong');
            if (chip) chip.textContent = preferences.displayName;
            toast('Profile saved.');
          });
        };
    }

    // Delegated interface actions and browser navigation events.
    document.querySelector('.skip-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      closeNavigation();
      const main = document.querySelector('#main');
      main?.focus({ preventScroll: true });
      main?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    app.addEventListener('click', async (e) => {
      if (e.target.closest('.sidebar a') && mobileNavigation.matches) closeNavigation();
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      if (target.tagName === 'BUTTON') e.preventDefault();
      try {
        if (action === 'onboarding-next' || action === 'onboarding-back') {
          onboardingStep = Math.max(
            0,
            Math.min(2, onboardingStep + (action === 'onboarding-next' ? 1 : -1)),
          );
          await render();
          document.querySelector('#onboarding-step-title')?.focus({ preventScroll: true });
        }
        if (action === 'onboarding-dismiss') {
          target.disabled = true;
          try {
            await service.dismissOnboarding();
            onboardingStep = 0;
            onboardingPreview = false;
            await render();
            document.querySelector('#main')?.focus({ preventScroll: true });
          } finally {
            target.disabled = false;
          }
        }
        if (action === 'replay-onboarding') {
          onboardingStep = 0;
          onboardingPreview = true;
          if (location.hash.split('?')[0] === '#dashboard') await render({ focus: true });
          else location.hash = '#dashboard';
        }
        if (action === 'settings-tab') {
          settingsTab = [
            'appearance',
            'notifications',
            ...(role === 'admin' ? ['data'] : []),
          ].includes(target.dataset.tab)
            ? target.dataset.tab
            : 'appearance';
          await render();
        }
        if (action === 'toggle-theme' || action === 'set-font') {
          target.disabled = true;
          try {
            applyAppearance(
              await service.saveAppearance({
                ...appearance,
                theme:
                  action === 'toggle-theme'
                    ? appearance.theme === 'dark'
                      ? 'light'
                      : 'dark'
                    : appearance.theme,
                fontSize: action === 'set-font' ? target.dataset.size : appearance.fontSize,
              }),
            );
            await render();
          } finally {
            target.disabled = false;
          }
        }
        if (action === 'toggle-notifications') {
          target.disabled = true;
          try {
            await service.saveNotifications(!preferences.allowNotifications);
            await render();
          } finally {
            target.disabled = false;
          }
        }
        if (action === 'remove-avatar') {
          await service.saveAvatar('');
          await render();
        }
        if (action === 'lock-reports') {
          await service.lockReports();
          currentIncident = null;
          await render();
        }
        if (action === 'reply-permission' && inboxCurrent) {
          target.disabled = true;
          try {
            await service.setReplyPermission(inboxCurrent.id, {
              decision: target.dataset.decision,
              expectedVersion: inboxCurrent.version,
            });
            if (document.querySelector('#message-form')?.dataset.dirty) await refreshConversation();
            else await render();
          } finally {
            target.disabled = false;
          }
        }
        if (action === 'read-all-activity') {
          await service.markActivityRead((await service.listActivity()).map((a) => a.id));
          await render();
        }
        if (action === 'open-activity') {
          const activity = (await service.listActivity()).find((a) => a.id === target.dataset.id);
          if (activity) {
            await service.markActivityRead([activity.id]);
            if (activity.announcementId) {
              const announcement = await service.getAnnouncement(activity.announcementId, { role });
              openDialog('University announcement', announcementBody(announcement));
              await refreshActivityBadge();
              target.classList.remove('unread');
              target.querySelector('.activity-dot')?.remove();
            } else location.hash = activity.href;
          }
        }
        if (action === 'toggle-nav' || action === 'close-nav') {
          const open = action === 'toggle-nav' && !document.body.classList.contains('nav-open');
          document.body.classList.toggle('nav-open', open);
          syncNavigation();
          if (open) document.querySelector('.sidebar a').focus();
          else document.querySelector('.mobile-menu').focus();
        }
        if (action === 'view-status' && STATUSES.includes(target.dataset.status)) {
          if (role === 'admin') {
            adminQueueFilters = { ...defaultAdminQueueFilters(), status: target.dataset.status };
            adminQueuePage = 0;
          } else filters = { ...defaultReportFilters(), status: target.dataset.status };
          location.hash = '#reports';
        }
        if (action === 'clear-admin-queue' && role === 'admin') {
          adminQueueFilters = defaultAdminQueueFilters();
          adminQueuePage = 0;
          adminQueueAdvanced = false;
          await render();
        }
        if (action === 'queue-previous' && role === 'admin') {
          adminQueuePage = Math.max(0, adminQueuePage - 1);
          await render({ focus: true });
        }
        if (action === 'queue-next' && role === 'admin') {
          adminQueuePage++;
          await render({ focus: true });
        }
        if (action === 'view-weapon-reports' && role === 'admin') {
          adminQueueFilters = { ...defaultAdminQueueFilters(), category: 'weapon' };
          adminQueuePage = 0;
          location.hash = '#reports';
        }
        if (action === 'view-emergency-announcements' && role === 'admin') {
          announcementFilters = { query: '', category: 'Emergency advisory', status: 'Published' };
          location.hash = '#announcements';
        }
        if (action === 'help')
          openDialog(
            role === 'admin' ? 'Administrator guide' : 'Reporting guide',
            reportingGuide(),
          );
        if (action === 'safety')
          openDialog(
            'When safety can’t wait',
            `${callout('<strong>Immediate danger or an urgent weapon-related threat?</strong><br>Follow City of Malabon University’s established emergency reporting procedures immediately.', 'warning')}<p>CMUAlert supports reporting and monitoring. It does not guarantee an immediate response, independently verify allegations, or replace official university investigation and disciplinary procedures.</p>`,
          );
        if (action === 'report-back') {
          captureReport();
          reportStep = Math.max(0, reportStep - 1);
          await render({ focus: true });
        }
        if (action === 'clear-category' && reportDraft) {
          reportDraft.category = '';
          const form = document.querySelector('#category-form');
          form.querySelectorAll('input[name="category"]').forEach((input) => {
            input.checked = false;
          });
          clearFieldError(form.querySelector('input[name="category"]'));
          document.querySelector('#category-selection-note').textContent = 'No category selected';
          target.disabled = true;
          form.querySelector('input[name="category"]').focus({ preventScroll: true });
        }
        if (action === 'report-category') {
          captureReport();
          reportStep = 0;
          await render({ focus: true });
        }
        if (action === 'remove-file') {
          captureReport();
          reportDraft.files.splice(Number(target.dataset.index), 1);
          document.querySelector('#selected-files').innerHTML = selectedFiles();
        }
        if (action === 'copy-tracking') {
          try {
            await navigator.clipboard.writeText(receipt.trackingReference);
            toast('Tracking reference copied.');
          } catch {
            const range = document.createRange();
            range.selectNodeContents(document.querySelector('#tracking-reference'));
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            toast('Reference selected. Use your browser’s Copy command.', 'error');
          }
        }
        if (action === 'clear-tracking') {
          clearTracking();
          await render();
          document.querySelector('#tracking-input')?.focus();
        }
        if (action === 'download-receipt' && receipt) downloadReceipt(receipt);
        if (action === 'clear-report-filters') {
          filters = defaultReportFilters();
          await render();
        }
        if (action === 'clear-announcement-filters') {
          announcementFilters = { query: '', category: '', status: '' };
          await render();
        }
        if (action === 'clear-account-filters') {
          accountFilters = { query: '', role: '', status: '' };
          await render();
        }
        if (action === 'clear-audit-filters') {
          auditFilters = { query: '', action: '', scope: '' };
          auditPage = 0;
          await render();
        }
        if (action === 'audit-previous') {
          auditPage = Math.max(0, auditPage - 1);
          await render();
        }
        if (action === 'audit-next') {
          auditPage++;
          await render();
        }
        if (action === 'view-attachment') {
          target.disabled = true;
          try {
            const blob = await service.getAttachment(target.dataset.report, target.dataset.id, {
              role,
            });
            const record = currentIncident.attachments.find((a) => a.id === target.dataset.id);
            const url = URL.createObjectURL(blob);
            openDialog(
              'Report attachment',
              `<p class="attachment-modal-name">${escape(record.name)}</p>${
                blob.type.startsWith('image/')
                  ? `<img class="attachment-preview" src="${url}" alt="${escape(record.name)}">`
                  : [
                      `<div class="pdf-placeholder">${icon('report')}<p>PDF document · ${(blob.size / 1024).toFixed(0)} KB</p>`,
                      `</div>`,
                    ].join('')
              }`,
              `<a class="btn btn-primary" href="${url}" download="${escape(record.name)}">${icon('download')} Download attachment</a>`,
            );
            dialog.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
          } finally {
            target.disabled = false;
          }
        }
        if (action === 'read-announcement') {
          const a = await service.getAnnouncement(target.dataset.id, { role });
          if (currentUser && !currentUser.mustChangePassword) {
            await service.markActivityRead(
              (await service.listActivity())
                .filter((item) => item.announcementId === a.id)
                .map((item) => item.id),
            );
            await refreshActivityBadge();
          }
          openDialog('University announcement', announcementBody(a));
        }
        if (action === 'new-announcement') {
          announcementDraft = null;
          announcementDirty = false;
          location.hash = '#announcements/new';
        }
        if (action === 'edit-announcement') {
          announcementDraft = null;
          announcementDirty = false;
          location.hash = `#announcements/edit/${target.dataset.id}`;
        }
        if (action === 'preview-announcement') {
          const form = document.querySelector('#announcement-form');
          if (!form.reportValidity()) return;
          openDialog('Announcement preview', announcementBody(captureAnnouncement(), true));
        }
        if (action === 'archive-announcement') {
          if (
            !(await confirmAction(
              'Archive this announcement?',
              '<p>It will be removed from audience feeds and emergency banners, and retained in administrator management.</p>',
              'Archive announcement',
            ))
          )
            return;
          await service.archiveAnnouncement(target.dataset.id, Number(target.dataset.version));
          await render();
          toast('Announcement archived.');
        }
        if (action === 'sign-out') {
          captureReport();
          captureAnnouncement();
          if (
            hasUnsavedChanges() &&
            !(await confirmAction(
              'Sign out with unsaved changes?',
              '<p>Unsaved changes will be lost. Saved records will remain.</p>',
              'Sign out',
            ))
          )
            return;
          discardSettingsChanges();
          // The hashchange handler renders once, preserving input entered on the new login form.
          await service.signOut();
          clearLocalView();
          acceptingNavigation = true;
          location.hash = '#login';
        }
        if (action === 'toggle-password') {
          const input = document.getElementById(target.dataset.target);
          const showing = input.type === 'password';
          input.type = showing ? 'text' : 'password';
          target.setAttribute('aria-pressed', String(showing));
          target.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        }
        if (action === 'access-help')
          openDialog(
            'Sign-in help',
            '<p>Use <strong>Create an account</strong> to register. Authorized personnel can use the first-administrator setup.</p><p>Sign in with your registered CMU ID or username. Use the browser and address where you created your account.</p>',
          );
        if (action === 'backup-data' || action === 'backup-damaged') {
          const raw = await service.exportStoredData({ damagedOnly: action === 'backup-damaged' });
          downloadText('cmualert-browser-records-' + localDate() + '.json', raw);
          toast('Records downloaded.');
        }
        if (action === 'reset-data' || action === 'reset-damaged') {
          if (!(await confirmDataReset(action === 'reset-damaged'))) return;
          clearLocalView();
          await service.initialize();
          acceptingNavigation = true;
          if (location.hash === '#login') await render({ focus: true });
          else location.hash = '#login';
          toast('CMUAlert data has been cleared.');
        }
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    window.addEventListener('hashchange', async () => {
      const nextHash = location.hash || '#dashboard';
      captureReport();
      captureAnnouncement();
      const leavingReport =
        lastHash.startsWith('#report/new') && !nextHash.startsWith('#report/new') && dirtyReport();
      const leavingAnnouncement =
        /#announcements\/(new|edit)/.test(lastHash) &&
        !/#announcements\/(new|edit)/.test(nextHash) &&
        announcementDirty;
      if (
        !acceptingNavigation &&
        (leavingReport || leavingAnnouncement || dirtyAdminForm() || dirtySettingsForm())
      ) {
        if (
          !(await confirmAction(
            'Leave this unsaved form?',
            '<p>Your unsaved information will be cleared. Saved records will stay available.</p>',
            'Leave form',
          ))
        ) {
          history.replaceState(null, '', lastHash);
          return;
        }
      }
      discardSettingsChanges();
      acceptingNavigation = false;
      if (leavingReport || !nextHash.startsWith('#report/new')) {
        releaseFilePreviews();
        reportDraft = null;
        reportStep = 0;
        receipt = null;
      }
      if (!/#announcements\/(new|edit)/.test(nextHash)) {
        announcementDraft = null;
        announcementDirty = false;
      }
      closeNavigation();
      lastHash = nextHash;
      if (nextHash.split('?')[0] !== '#track') trackingRequestId++;
      await render({ focus: true });
    });
    window.addEventListener('beforeunload', (e) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && dialog.open) {
        const focusable = [
          ...dialog.querySelectorAll(
            'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((el) => !el.disabled && el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        const outside = !dialog.contains(document.activeElement);
        if (first && e.shiftKey && (outside || document.activeElement === first)) {
          e.preventDefault();
          last.focus();
        } else if (first && !e.shiftKey && (outside || document.activeElement === last)) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) closeNavigation(true);
      if (
        e.key === 'Tab' &&
        mobileNavigation.matches &&
        document.body.classList.contains('nav-open')
      ) {
        const focusable = [
          ...document.querySelectorAll('.sidebar a, .sidebar button, .sidebar select'),
        ].filter((el) => !el.disabled && el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
    // Synchronize saved changes across views and browser tabs.
    async function refreshConversation() {
      if (!inboxCurrent || !location.hash.startsWith('#inbox/')) return;
      const path = location.hash;
      const latest = await service.getConversation(inboxCurrent.id);
      if (location.hash !== path || !document.querySelector('#message-form')) return;
      inboxCurrent = latest;
      const contents = conversationContents(latest);
      const messages = document.querySelector('#conversation-messages');
      if (messages.innerHTML !== contents.messages) messages.innerHTML = contents.messages;
      document.querySelector('#reply-permission').innerHTML = contents.permission;
      const form = document.querySelector('#message-form');
      form.dataset.version = latest.version;
      form.hidden =
        !latest.participantActive || (role !== 'admin' && latest.replyStatus !== 'approved');
      await service.markConversationRead(latest.id);
    }
    function refreshConnectedViews() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        const path = location.hash;
        try {
          if (currentUser && !(await service.getSession())) {
            clearLocalView();
            await render();
            return;
          }
        } catch {
          clearLocalView();
          await render();
          return;
        }
        await refreshAdvisoryBanner();
        try {
          applyAppearance(await service.getAppearance());
          if (currentUser && !currentUser.mustChangePassword) await refreshActivityBadge();
          if (
            location.hash.startsWith('#inbox/') &&
            document.querySelector('#message-form')?.dataset.dirty
          ) {
            await refreshConversation();
            return;
          }
        } catch (error) {
          toast(error.message, 'error');
          return;
        }
        if (document.querySelector('#access-form')?.dataset.dirty) return;
        const trackingForm = document.querySelector('#tracking-form');
        if (trackingForm?.dataset.dirty || trackingForm?.dataset.busy) return;
        const queueFilters = document.querySelector('#admin-queue-filters');
        if (queueFilters?.dataset.dirty || queueFilters?.dataset.busy) return;
        const reportFilters = document.querySelector('#report-filters');
        if (reportFilters?.dataset.dirty || reportFilters?.dataset.busy) return;
        // Never replace an active form while the user is writing. Version checks protect saves.
        if (
          /report\/new|announcements\/(new|edit)|accounts\/(new|edit)|settings|profile/.test(
            path,
          ) ||
          dirtyAdminForm() ||
          dirtySettingsForm()
        )
          return;
        if (path === '#track' && tracked) {
          const requestId = trackingRequestId;
          try {
            const result = await service.trackAnonymous(trackingValue);
            if (requestId !== trackingRequestId || location.hash !== path) return;
            tracked = result;
          } catch {
            if (requestId !== trackingRequestId || location.hash !== path) return;
            tracked = null;
          }
        }
        await render();
      }, 100);
    }
    service.subscribe(refreshConnectedViews);
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) service.notifyExternalChange();
    });

    try {
      await service.initialize();
    } catch (error) {
      storageError = error.message;
    }
    await render();

    return {};
  })();
})().catch(function (error) {
  console.error('CMUAlert startup failed', error);
  const app = document.getElementById('app');
  if (app) {
    app.textContent =
      'CMUAlert could not start. Please use a modern browser and allow local storage.';
  }
});
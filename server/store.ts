import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Alert,
  AlertStatus,
  AlertType,
  Database,
  Member,
  MemberRole,
  MemberStatus,
  Overview,
} from './types.js';

export interface StoreOptions {
  /** Absolute or relative path of the JSON database file. `null` keeps everything in memory. */
  file?: string | null;
  /** Seed a demo family when the database is empty. Defaults to true. */
  seed?: boolean;
  /** Clock injection point so tests can produce deterministic timestamps. */
  now?: () => Date;
}

export interface NewMemberInput {
  name: string;
  role: MemberRole;
}

export interface NewAlertInput {
  memberId: string;
  type: AlertType;
  message: string;
}

function emptyDatabase(): Database {
  return { members: [], alerts: [] };
}

/**
 * Small JSON-file backed store. Reads are synchronous from an in-memory copy,
 * writes are atomic (temp file + rename) so a crash cannot truncate the database.
 */
export class FamGuardStore {
  private db: Database;
  private readonly file: string | null;
  private readonly now: () => Date;

  constructor(options: StoreOptions = {}) {
    this.file = options.file ?? null;
    this.now = options.now ?? (() => new Date());
    this.db = this.file ? this.load() : emptyDatabase();
    if (options.seed !== false && this.db.members.length === 0 && this.db.alerts.length === 0) {
      this.seed();
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private load(): Database {
    if (!this.file) return emptyDatabase();
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Database>;
      return {
        members: Array.isArray(parsed.members) ? parsed.members : [],
        alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      };
    } catch {
      return emptyDatabase();
    }
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.db, null, 2)}\n`, 'utf8');
    renameSync(temp, this.file);
  }

  private seed(): void {
    const createdAt = this.timestamp();
    const family: Array<Pick<Member, 'name' | 'role'>> = [
      { name: 'Priya Raman', role: 'parent' },
      { name: 'Daniel Raman', role: 'parent' },
      { name: 'Maya Raman', role: 'child' },
      { name: 'Noah Raman', role: 'child' },
    ];
    this.db.members = family.map((member) => ({
      id: randomUUID(),
      name: member.name,
      role: member.role,
      status: 'unknown',
      lastCheckIn: null,
      createdAt,
    }));
    const maya = this.db.members[2];
    const daniel = this.db.members[1];
    if (maya) {
      this.db.alerts.push({
        id: randomUUID(),
        memberId: maya.id,
        type: 'geofence',
        message: 'Left the school safe zone before pickup time.',
        status: 'open',
        createdAt,
        acknowledgedAt: null,
      });
      maya.status = 'needs_attention';
    }
    if (daniel) {
      this.db.alerts.push({
        id: randomUUID(),
        memberId: daniel.id,
        type: 'low_battery',
        message: 'Phone battery dropped below 10% during the commute.',
        status: 'acknowledged',
        createdAt,
        acknowledgedAt: createdAt,
      });
    }
    this.persist();
  }

  listMembers(): Member[] {
    return [...this.db.members];
  }

  getMember(id: string): Member | null {
    return this.db.members.find((member) => member.id === id) ?? null;
  }

  addMember(input: NewMemberInput): Member {
    const member: Member = {
      id: randomUUID(),
      name: input.name,
      role: input.role,
      status: 'unknown',
      lastCheckIn: null,
      createdAt: this.timestamp(),
    };
    this.db.members.push(member);
    this.persist();
    return member;
  }

  checkIn(id: string): Member | null {
    const member = this.getMember(id);
    if (!member) return null;
    member.lastCheckIn = this.timestamp();
    member.status = 'safe';
    this.persist();
    return member;
  }

  setStatus(id: string, status: MemberStatus): Member | null {
    const member = this.getMember(id);
    if (!member) return null;
    member.status = status;
    this.persist();
    return member;
  }

  listAlerts(filter: { status?: AlertStatus; memberId?: string } = {}): Alert[] {
    return this.db.alerts
      .filter((alert) => (filter.status ? alert.status === filter.status : true))
      .filter((alert) => (filter.memberId ? alert.memberId === filter.memberId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createAlert(input: NewAlertInput): Alert | null {
    const member = this.getMember(input.memberId);
    if (!member) return null;
    const alert: Alert = {
      id: randomUUID(),
      memberId: member.id,
      type: input.type,
      message: input.message,
      status: 'open',
      createdAt: this.timestamp(),
      acknowledgedAt: null,
    };
    this.db.alerts.push(alert);
    member.status = 'needs_attention';
    this.persist();
    return alert;
  }

  acknowledgeAlert(id: string): Alert | null {
    const alert = this.db.alerts.find((candidate) => candidate.id === id);
    if (!alert) return null;
    if (alert.status !== 'acknowledged') {
      alert.status = 'acknowledged';
      alert.acknowledgedAt = this.timestamp();
    }
    const member = this.getMember(alert.memberId);
    if (member && this.openAlertCount(member.id) === 0) {
      member.status = 'safe';
    }
    this.persist();
    return alert;
  }

  openAlertCount(memberId: string): number {
    return this.db.alerts.filter((alert) => alert.memberId === memberId && alert.status === 'open').length;
  }

  overview(): Overview {
    const members = this.db.members;
    const openAlerts = this.db.alerts.filter((alert) => alert.status === 'open').length;
    return {
      totalMembers: members.length,
      safeMembers: members.filter((member) => member.status === 'safe').length,
      needsAttention: members.filter((member) => member.status === 'needs_attention').length,
      unknownMembers: members.filter((member) => member.status === 'unknown').length,
      openAlerts,
      lastUpdated: this.timestamp(),
    };
  }
}

import { ForbiddenException } from '@nestjs/common';
import {
  assertRowNotLocked,
  assertStatusTransition,
  filterPatchByRole,
} from './application.policy';
import { APPLICATION_STATUSES } from '../constants';

describe('ApplicationPolicy', () => {
  describe('assertStatusTransition', () => {
    it('allows Pending -> Applied for a bidder', () => {
      expect(() => assertStatusTransition('Pending', 'Applied', 'bidder')).not.toThrow();
    });

    it('allows Applied -> Rejected for a bidder_manager', () => {
      expect(() => assertStatusTransition('Applied', 'Rejected', 'bidder_manager')).not.toThrow();
    });

    it('blocks Rejected -> Applied for a bidder', () => {
      expect(() => assertStatusTransition('Rejected', 'Applied', 'bidder')).toThrow(
        ForbiddenException,
      );
    });

    it('blocks Rejected -> Pending for a bidder', () => {
      expect(() => assertStatusTransition('Rejected', 'Pending', 'bidder')).toThrow(
        ForbiddenException,
      );
    });

    it('blocks any -> Duplicated for a bidder', () => {
      for (const from of ['Pending', 'Applied', 'Rejected']) {
        expect(() => assertStatusTransition(from, 'Duplicated', 'bidder')).toThrow(
          ForbiddenException,
        );
      }
    });

    it('blocks Duplicated -> any for a bidder_manager', () => {
      for (const to of ['Pending', 'Applied', 'Rejected']) {
        expect(() => assertStatusTransition('Duplicated', to, 'bidder_manager')).toThrow(
          ForbiddenException,
        );
      }
    });

    it('allows every transition for admin', () => {
      const all = APPLICATION_STATUSES;
      for (const from of all) {
        for (const to of all) {
          expect(() => assertStatusTransition(from, to, 'admin')).not.toThrow();
        }
      }
    });

    it.each(['bidder', 'bidder_manager'])('blocks manual Banned transitions for %s', (role) => {
      for (const status of APPLICATION_STATUSES.filter((value) => value !== 'Banned')) {
        expect(() => assertStatusTransition(status, 'Banned', role)).toThrow(ForbiddenException);
        expect(() => assertStatusTransition('Banned', status, role)).toThrow(ForbiddenException);
      }
    });

    it('is a no-op when status is unchanged', () => {
      expect(() => assertStatusTransition('Duplicated', 'Duplicated', 'bidder')).not.toThrow();
    });
  });

  describe('assertRowNotLocked', () => {
    it('blocks non-admins on paid rows', () => {
      expect(() => assertRowNotLocked({ paid: true }, 'bidder_manager')).toThrow(ForbiddenException);
    });
    it('allows admin on paid rows', () => {
      expect(() => assertRowNotLocked({ paid: true }, 'admin')).not.toThrow();
    });
    it('allows anyone on unpaid rows', () => {
      expect(() => assertRowNotLocked({ paid: false }, 'bidder')).not.toThrow();
    });
    it('blocks non-admins on rejected rows', () => {
      expect(() => assertRowNotLocked({ paid: false, application_status: 'Rejected' }, 'bidder'))
        .toThrow(ForbiddenException);
      expect(() => assertRowNotLocked({ paid: false, application_status: 'Rejected' }, 'bidder_manager'))
        .toThrow(ForbiddenException);
    });
    it('allows admins to modify rejected rows', () => {
      expect(() => assertRowNotLocked({ paid: false, application_status: 'Rejected' }, 'admin'))
        .not.toThrow();
    });
    it.each(['bidder', 'bidder_manager'])('locks banned rows for %s', (role) => {
      expect(() => assertRowNotLocked({ paid: false, application_status: 'Banned' }, role))
        .toThrow('Banned applications are locked');
    });
    it.each(['admin', 'super_admin'])('allows %s to modify banned rows', (role) => {
      expect(() => assertRowNotLocked({ paid: false, application_status: 'Banned' }, role))
        .not.toThrow();
    });
  });

  describe('filterPatchByRole', () => {
    const current = {
      job_title: 'Old', pipeline_status: 'Not Started', paid: false, number: 5,
    };

    it('keeps bidder-writable fields', () => {
      expect(filterPatchByRole({ job_title: 'New' }, current, 'bidder')).toEqual({ job_title: 'New' });
    });

    it('throws when a bidder tries to change pipeline_status', () => {
      expect(() =>
        filterPatchByRole({ pipeline_status: 'Technical Interview' }, current, 'bidder'),
      ).toThrow(ForbiddenException);
    });

    it('throws when a bidder tries to set paid', () => {
      expect(() => filterPatchByRole({ paid: true }, current, 'bidder')).toThrow(ForbiddenException);
    });

    it('limits bidder edits on duplicated rows to review fields', () => {
      const duplicated = { ...current, application_status: 'Duplicated' };
      expect(filterPatchByRole({ company_name: 'New Co', note: 'Keep' }, duplicated, 'bidder'))
        .toEqual({ company_name: 'New Co', note: 'Keep' });
      expect(() => filterPatchByRole({ date: '2026-08-27' }, duplicated, 'bidder'))
        .toThrow(ForbiddenException);
      expect(() => filterPatchByRole({ url: 'https://example.com' }, duplicated, 'bidder_manager'))
        .toThrow(ForbiddenException);
    });

    it('silently drops unchanged admin-only fields (whole-row PATCH stays convenient)', () => {
      const out = filterPatchByRole(
        { job_title: 'New', pipeline_status: 'Not Started', paid: false, number: 5 },
        current,
        'bidder',
      );
      expect(out).toEqual({ job_title: 'New' });
    });

    it('drops derived/system fields entirely', () => {
      const out = filterPatchByRole(
        { id: 'hack', normalized_url: 'x', created_at: 'y', note: 'ok' } as any,
        current,
        'bidder',
      );
      expect(out).toEqual({ note: 'ok' });
    });

    it('passes everything through for admin', () => {
      const patch = { pipeline_status: 'Offer Received', paid: true };
      expect(filterPatchByRole(patch, current, 'admin')).toEqual(patch);
    });
  });
});

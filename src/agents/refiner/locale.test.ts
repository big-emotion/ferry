import { describe, it, expect } from 'vitest';
import { detectLocale } from './locale.js';

describe('detectLocale (Story 3-2 D9)', () => {
  it.each([
    ['Le client veut un bouton de connexion sur la page d accueil', 'fr'],
    ['Pour résoudre le problème, il faut ajouter une vérification', 'fr'],
  ] as const)('detects French: %s', (text, expected) => {
    expect(detectLocale(text)).toBe(expected);
  });

  it.each([
    ['User wants a login button on the home page', 'en'],
    ['Add a check that prevents the bug from reappearing', 'en'],
  ] as const)('detects English: %s', (text, expected) => {
    expect(detectLocale(text)).toBe(expected);
  });

  it('defaults to en when no signal', () => {
    expect(detectLocale('')).toBe('en');
    expect(detectLocale('abc 123 xyz')).toBe('en');
  });
});

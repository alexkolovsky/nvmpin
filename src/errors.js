// Exit codes: 0 ok, 1 user error, 2 environment error, 3 internal.

export class UserError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'UserError';
    this.exitCode = 1;
    this.hint = hint;
  }
}

export class EnvError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'EnvError';
    this.exitCode = 2;
    this.hint = hint;
  }
}

/** Allows a resolved background check to retire only its own current notice. */
export class CreatorNoticeOwnership {
  private owner: string | undefined;
  publish(owner?: string) {
    this.owner = owner;
  }
  resolve(owner: string) {
    if (this.owner !== owner) return false;
    this.owner = undefined;
    return true;
  }
}

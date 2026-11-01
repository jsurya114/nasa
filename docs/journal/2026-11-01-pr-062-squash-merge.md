# Merge method: squash and merge for every pull request

- **Date:** 2026-11-01
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** none / see the pull request for this branch
- **Branch:** `docs/squash-merge`
- **Type and scope:** docs(repo)
- **Files touched:** `CONTRIBUTING.md` (section 5), `.github/pull_request_template.md`. No application code.

**What and why.** The owner decided that every pull request is merged with "Squash and merge". Until now the rules said "Create a merge commit". With squash, one pull request is one commit on `develop`: the history is one readable line per change, and a bad change is reverted with one revert. The squashed commit takes the pull request title, which the rules already require to be in the `<type>(<scope>): <subject>` format (72 characters or fewer). The documents now say so.

**GitHub setting.** Squash merging was already allowed on the repository, with the default title taken from the pull request title when it has several commits. Nothing in the repository settings was changed.

**Database.** None. **Config and dependencies.** None. **Money impact.** None.

**Tested.** Documentation only. Checked that no other file in the repository still tells people to create a merge commit.

**Things to know (decision for the owner).**
- **The release pull request `develop` → `main`.** If it is squashed, `main` gets one new commit that `develop` does not contain. `develop` and `main` then differ in history even though their files match, and the next release shows the same changes again and can conflict. The usual practice is to merge the release pull request with a merge commit and squash everything else. This document says "ask before merging it" until the owner decides.
- **Squashing loses the branch's individual commits** (the journal files and the pull request description still say what each change did). The commit messages of the squashed pull request are kept in the commit body by GitHub's default setting.
- **Pull requests already open** (#47, #48, #49, #50, #57 to #61) still contain merge commits from `develop`; squashing them is fine and tidies that up.
- The CI "commit messages" check still checks every commit in the pull request, not the final squashed one. The pull request title is not checked by CI; reviewers should look at it.

# Key Learnings – sprint-148-9f1a2b

- **Bash Arrays for CLI Commands**: Bash arrays are the standard way to safely assemble and execute CLI commands with dynamic arguments. They preserve whitespace and quotes within each array element.
- **Eval Risks**: `eval` should be used with extreme caution as it performs multiple rounds of shell expansion, which can lead to bugs or security vulnerabilities when data contains shell-metacharacters like single quotes.
- **Gcloud Custom Delimiters**: While `gcloud` supports custom delimiters for `--set-env-vars`, the shell still needs to pass the entire argument correctly to the `gcloud` process. Safe quoting at the shell level is still necessary.

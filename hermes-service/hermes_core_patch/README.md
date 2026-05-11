These files are tracked snapshots of the local Hermes core runtime patches
currently installed in the project virtualenv.

Source runtime paths:
- `/Users/evanroche/PycharmProjects/fontbuilder/hermes-service/.venv/lib/python3.13/site-packages/hermes_cli/plugins.py`
- `/Users/evanroche/PycharmProjects/fontbuilder/hermes-service/.venv/lib/python3.13/site-packages/cli.py`

Tracked copies in this folder:
- `plugins.py`
- `cli.py`

Purpose:
- preserve the local silent-injection Hermes CLI patch in git
- provide a quick recovery path if the installed runtime gets replaced

To restore these exact versions into the local runtime:

```bash
cp /Users/evanroche/PycharmProjects/fontbuilder/hermes-service/hermes_core_patch/plugins.py /Users/evanroche/PycharmProjects/fontbuilder/hermes-service/.venv/lib/python3.13/site-packages/hermes_cli/plugins.py
cp /Users/evanroche/PycharmProjects/fontbuilder/hermes-service/hermes_core_patch/cli.py /Users/evanroche/PycharmProjects/fontbuilder/hermes-service/.venv/lib/python3.13/site-packages/cli.py
```

#!/bin/bash
set -euo pipefail
# This script is run in the VM each time you run `vagrant-spk dev`.  This is
# the ideal place to invoke anything which is normally part of your app's build
# process - transforming the code in your repository into the collection of files
# which can actually run the service in production
#
# Some examples:
#
#   * For a C/C++ application, calling
#       ./configure && make && make install
#   * For a Python application, creating a virtualenv and installing
#     app-specific package dependencies:
#       virtualenv /opt/app/env
#       /opt/app/env/bin/pip install -r /opt/app/requirements.txt
#   * Building static assets from .less or .sass, or bundle and minify JS
#   * Collecting various build artifacts or assets into a deployment-ready
#     directory structure

# By default, this script does nothing.  You'll have to modify it as
# appropriate for your application.
cd /opt/app

npm install
npm run build:sandstorm

# Refresh shared-library targets for the build VM. spk preserves symlinks,
# so both the stable SONAME and its installed target must be in the file list.
# Discard previously recorded versioned targets before resolving them again.
mapfile -t package_files < <(sed -E '\|^usr/lib/.*\.so\.[0-9]+\.[0-9.]+$|d' .sandstorm/sandstorm-files.list)
library_targets=()
for package_file in "${package_files[@]}"; do
  if [[ "$package_file" == usr/lib/*.so.* ]]; then
    if ! library_target=$(readlink -e "/$package_file"); then
      echo "Missing required runtime library: /$package_file" >&2
      exit 1
    fi
    library_targets+=("${library_target#/}")
  fi
done
printf '%s\n' "${package_files[@]}" "${library_targets[@]}" | sort -u > .sandstorm/sandstorm-files.list

# bower install

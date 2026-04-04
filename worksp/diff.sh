selfdir=$(dirname "$(realpath "$0")")
diff -r -u -U 0 $1 $2 > $selfdir/out.diff
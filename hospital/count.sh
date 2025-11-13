

DIR="/home/devops/hospital"

if [ -d "$DIR" ]; then
    count=$(find "$DIR" -type f | wc -l)
    echo "Total files in $DIR: $count"
else
    echo "Directory $DIR does not exist."
fi

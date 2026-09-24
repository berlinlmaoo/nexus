# kotlinx.serialization keeps its generated serializers via its own consumer rules.
# Keep @Serializable model names stable for readable crash reports.
-keepattributes *Annotation*, InnerClasses

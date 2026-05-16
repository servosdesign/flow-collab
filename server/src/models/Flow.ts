import { Schema, model } from "mongoose";

const flowSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    nodes: [Schema.Types.Mixed],
    edges: [Schema.Types.Mixed],
    viewport: {
      type: Schema.Types.Mixed,
      required: false
    }
  },
  {
    timestamps: true,
    minimize: false,
    versionKey: false
  }
);

flowSchema.set("toJSON", {
  transform(_document, ret) {
    const json = ret as Record<string, unknown>;
    delete json._id;
    return ret;
  }
});

export const FlowModel = model("Flow", flowSchema);
